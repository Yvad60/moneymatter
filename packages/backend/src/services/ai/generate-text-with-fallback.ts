import { logger } from '@js/utils/logger';
import { type AiAttemptFailureKind, trackAiModelAnswered, trackAiModelAttemptFailed } from '@js/utils/posthog';
import { redisClient } from '@root/redis-client';
import { type GenerateTextResult, NoObjectGeneratedError, type OutputInterface, type ToolSet, generateText } from 'ai';

import { type ProviderModelSpec, createProviderModel } from './ai-client-factory';
import { getHttpStatus, isAbortError, isTemporaryError, unwrapRetryError } from './ai-error-classifiers';

type GenerateTextParams<OUTPUT extends OutputInterface> = Parameters<typeof generateText<ToolSet, OUTPUT>>[0];

// A plain Omit collapses the SDK's `prompt | messages` union into one object with both optional.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type FallbackModel = ProviderModelSpec & {
  maxRetries?: number;
  providerOptions?: GenerateTextParams<OutputInterface>['providerOptions'];
};

const COOLDOWN_SECONDS = 120;

// ponytail: one cooldown per model; scope it by API key and base URL once callers bring per-user keys.
export const buildCooldownKey = ({ provider, model }: { provider: string; model: string }) =>
  `ai_cooldown:${provider}:${model}`;

interface AttemptFailure {
  kind: AiAttemptFailureKind;
  httpStatus: number | null;
  /** A provider-availability signal: starts a cooldown and logs at info, not warn. */
  transient: boolean;
}

export function classifyAttemptFailure({ error }: { error: unknown }): AttemptFailure {
  const cause = unwrapRetryError({ error });
  const httpStatus = getHttpStatus({ error: cause }) ?? null;
  const aborted = isAbortError({ error: cause });
  const transient = isTemporaryError({ error }) || aborted;

  if (httpStatus === 429) return { kind: 'rate_limited', httpStatus, transient };
  if (httpStatus === 503 || httpStatus === 529) return { kind: 'overloaded', httpStatus, transient };
  if (httpStatus !== null && httpStatus >= 500) return { kind: 'server_error', httpStatus, transient };
  if (aborted) return { kind: 'timeout', httpStatus, transient };
  if (NoObjectGeneratedError.isInstance(cause)) return { kind: 'invalid_output', httpStatus, transient };
  return { kind: 'other', httpStatus, transient };
}

const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

async function demoteModelsInCooldown({ chain, label }: { chain: FallbackModel[]; label: string }) {
  try {
    const marks = await redisClient.mget(...chain.map(buildCooldownKey));
    const available = chain.filter((_, index) => marks[index] === null);

    if (available.length === chain.length) return chain;

    const benched = chain.filter((entry) => !available.includes(entry));
    logger.info(`[${label}] Trying models in cooldown last`, { models: benched.map((entry) => entry.model) });
    return [...available, ...benched];
  } catch (error) {
    logger.warn(`[${label}] Cooldown lookup failed, trying the full chain`, { error: toError(error).message });
    return chain;
  }
}

function markModelDown({ entry }: { entry: FallbackModel }) {
  const key = buildCooldownKey(entry);

  redisClient.set(key, '1', 'EX', COOLDOWN_SECONDS).catch((error: Error) => {
    logger.warn('Cooldown mark failed', { key, error: error.message });
  });
}

type Failure = AttemptFailure & {
  entry: FallbackModel;
  position: number;
  durationMs: number;
};

type AttemptOutcome<OUTPUT extends OutputInterface> =
  | { result: GenerateTextResult<ToolSet, OUTPUT> }
  | (AttemptFailure & { error: Error });

/**
 * Runs one `generateText` request down a chain of models. Each model starts once the one before
 * it has failed or stayed silent for `hedgeAfterMs`; the first answer wins and the rest are
 * cancelled. Models in cooldown are tried last. Rejects with the last model's own error.
 */
export async function generateTextWithFallback<OUTPUT extends OutputInterface = OutputInterface<string, string>>({
  label,
  chain,
  request,
  validate,
  hedgeAfterMs,
  attemptTimeoutMs,
}: {
  /** Prefix for log lines and the `feature` of the outage events. */
  label: string;
  chain: FallbackModel[];
  request: DistributiveOmit<GenerateTextParams<OUTPUT>, 'model' | 'abortSignal' | 'maxRetries' | 'providerOptions'>;
  /** Throws to reject an answer; the chain then moves on as after any failure. */
  validate?: (args: { result: GenerateTextResult<ToolSet, OUTPUT> }) => void;
  hedgeAfterMs: number;
  attemptTimeoutMs: number;
}): Promise<{ result: GenerateTextResult<ToolSet, OUTPUT>; model: FallbackModel }> {
  if (chain.length === 0) throw new Error(`[${label}] The model chain is empty`);

  const candidates = await demoteModelsInCooldown({ chain, label });
  const startedAt = Date.now();
  const controller = new AbortController();
  const inFlight = new Map<number, { entry: FallbackModel; startedAt: number }>();
  const failures: Failure[] = [];
  const errors: Error[] = [];
  let hedgeTimer: NodeJS.Timeout | undefined;
  let launched = 0;
  let answered = false;

  const runAttempt = async ({ entry }: { entry: FallbackModel }): Promise<AttemptOutcome<OUTPUT>> => {
    const attemptController = new AbortController();
    const cancel = () => attemptController.abort(controller.signal.reason);
    const timer = setTimeout(
      () =>
        attemptController.abort(
          Object.assign(new Error(`${entry.model} did not answer in time`), { name: 'TimeoutError' }),
        ),
      attemptTimeoutMs,
    );
    controller.signal.addEventListener('abort', cancel, { once: true });

    let result: GenerateTextResult<ToolSet, OUTPUT>;
    try {
      result = await generateText<ToolSet, OUTPUT>({
        ...request,
        model: createProviderModel(entry),
        providerOptions: entry.providerOptions,
        maxRetries: entry.maxRetries,
        abortSignal: attemptController.signal,
      });
    } catch (error) {
      return { error: toError(error), ...classifyAttemptFailure({ error }) };
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', cancel);
    }

    try {
      validate?.({ result });
      return { result };
    } catch (error) {
      return { error: toError(error), kind: 'invalid_output', httpStatus: null, transient: false };
    }
  };

  const outcome = new Promise<{
    result: GenerateTextResult<ToolSet, OUTPUT>;
    position: number;
    entry: FallbackModel;
  }>((resolve, reject) => {
    const launchNext = () => {
      clearTimeout(hedgeTimer);
      const position = launched++;
      const entry = candidates[position];
      if (!entry) return;

      const attemptStartedAt = Date.now();
      inFlight.set(position, { entry, startedAt: attemptStartedAt });

      runAttempt({ entry })
        .then((attempt) => {
          inFlight.delete(position);
          // A loser that settles after another model answered is expected, not a failure.
          if (answered) return;

          if ('result' in attempt) {
            answered = true;
            resolve({ result: attempt.result, position, entry });
            return;
          }

          const { error, kind, httpStatus, transient } = attempt;
          const durationMs = Date.now() - attemptStartedAt;

          errors[position] = error;
          failures.push({ entry, position, durationMs, kind, httpStatus, transient });
          // warn reaches Sentry; a provider being busy is not worth an event there.
          logger[transient ? 'info' : 'warn'](`[${label}] Attempt failed`, {
            model: entry.model,
            durationMs,
            kind,
            cooldownStarted: transient,
            errorName: error.name,
            statusCode: httpStatus ?? undefined,
            error: error.message,
          });
          if (transient) markModelDown({ entry });

          if (position === launched - 1) launchNext();
          if (inFlight.size === 0 && launched >= candidates.length) reject(errors.at(-1));
        })
        .catch(reject);

      if (position + 1 < candidates.length) hedgeTimer = setTimeout(launchNext, hedgeAfterMs);
    };

    launchNext();
  });

  let answeredBy: FallbackModel | null = null;

  try {
    const { result, position, entry: winner } = await outcome;
    answeredBy = winner;

    // A model still silent when a later one answered is as good as down for the cooldown.
    for (const [stalledPosition, stalled] of inFlight) {
      if (stalledPosition >= position) continue;
      const durationMs = Date.now() - stalled.startedAt;
      failures.push({
        entry: stalled.entry,
        position: stalledPosition,
        durationMs,
        kind: 'stalled_past_hedge',
        httpStatus: null,
        transient: true,
      });
      logger.info(`[${label}] Model stalled past the hedge delay`, { model: stalled.entry.model, durationMs });
      markModelDown({ entry: stalled.entry });
    }

    trackAiModelAnswered({
      feature: label,
      provider: winner.provider,
      model: winner.model,
      chainPosition: position,
      durationMs: Date.now() - startedAt,
      failedAttempts: failures.length,
    });

    return { result, model: winner };
  } finally {
    clearTimeout(hedgeTimer);
    controller.abort();

    for (const failure of failures) {
      trackAiModelAttemptFailed({
        feature: label,
        provider: failure.entry.provider,
        model: failure.entry.model,
        chainPosition: failure.position,
        durationMs: failure.durationMs,
        failureKind: failure.kind,
        httpStatus: failure.httpStatus,
        cooldownStarted: failure.transient,
        answeredBy: answeredBy?.model ?? null,
      });
    }
  }
}
