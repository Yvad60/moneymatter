import { AI_PROVIDER } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { logger } from '@js/utils/logger';
import { redisClient } from '@root/redis-client';
import { APICallError, NoObjectGeneratedError, RetryError, generateText } from 'ai';

import { type FallbackModel, classifyAttemptFailure, generateTextWithFallback } from './generate-text-with-fallback';

jest.mock('ai', () => ({
  __esModule: true,
  ...(jest.requireActual('ai') as object),
  generateText: jest.fn(),
}));
jest.mock('@js/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const apiError = ({ statusCode }: { statusCode?: number }) =>
  new APICallError({ message: 'failed', url: 'https://api.example', requestBodyValues: {}, statusCode });

describe('classifyAttemptFailure', () => {
  it.each([
    [429, 'rate_limited', true],
    [503, 'overloaded', true],
    [529, 'overloaded', true],
    [500, 'server_error', true],
    [400, 'other', false],
    [401, 'other', false],
  ])('maps HTTP %i to %s (transient: %s)', (statusCode, kind, transient) => {
    expect(classifyAttemptFailure({ error: apiError({ statusCode }) })).toEqual({
      kind,
      httpStatus: statusCode,
      transient,
    });
  });

  it('reads the status through a RetryError', () => {
    const error = new RetryError({
      message: 'retries exhausted',
      reason: 'maxRetriesExceeded',
      errors: [apiError({ statusCode: 529 })],
    });

    expect(classifyAttemptFailure({ error })).toEqual({ kind: 'overloaded', httpStatus: 529, transient: true });
  });

  it('treats an aborted attempt as a transient timeout', () => {
    const error = Object.assign(new Error('timed out'), { name: 'TimeoutError' });

    expect(classifyAttemptFailure({ error })).toEqual({ kind: 'timeout', httpStatus: null, transient: true });
  });

  it('treats a schema mismatch as invalid output that is not transient', () => {
    const error = new NoObjectGeneratedError({
      message: 'no object',
      text: '{}',
      response: { id: 'r', timestamp: new Date(), modelId: 'm' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      finishReason: 'stop',
    });

    expect(classifyAttemptFailure({ error })).toEqual({ kind: 'invalid_output', httpStatus: null, transient: false });
  });
});

type Attempt = (args: { abortSignal: AbortSignal }) => Promise<unknown>;

const pendingUntilAborted: Attempt = ({ abortSignal }) =>
  new Promise((_, reject) => {
    abortSignal.addEventListener('abort', () => reject(abortSignal.reason));
  });

describe('generateTextWithFallback', () => {
  const generateTextMock = generateText as unknown as jest.Mock<Attempt>;
  const mgetMock = redisClient.mget as unknown as jest.Mock<() => Promise<(string | null)[]>>;

  const chain: FallbackModel[] = [
    { provider: AI_PROVIDER.anthropic, model: 'model-a', apiKey: 'key-a' },
    { provider: AI_PROVIDER.google, model: 'model-b', apiKey: 'key-b' },
  ];
  const answer = { text: 'ok' };

  const run = ({ hedgeAfterMs, attemptTimeoutMs }: { hedgeAfterMs: number; attemptTimeoutMs: number }) =>
    generateTextWithFallback({ label: 'Test', chain, request: { prompt: 'hi' }, hedgeAfterMs, attemptTimeoutMs });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    generateTextMock.mockReset();
    mgetMock.mockResolvedValue([null, null]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each<[number, 'info' | 'warn', 'info' | 'warn']>([
    [529, 'info', 'warn'],
    [400, 'warn', 'info'],
  ])('logs an attempt that failed with HTTP %i at %s', async (statusCode, level, otherLevel) => {
    generateTextMock.mockRejectedValueOnce(apiError({ statusCode })).mockResolvedValueOnce(answer);

    const { model } = await run({ hedgeAfterMs: 1_000, attemptTimeoutMs: 10_000 });

    expect(model.model).toBe('model-b');
    expect(logger[level]).toHaveBeenCalledWith('[Test] Attempt failed', expect.objectContaining({ model: 'model-a' }));
    expect(logger[otherLevel]).not.toHaveBeenCalledWith('[Test] Attempt failed', expect.anything());
    expect(redisClient.set).toHaveBeenCalledTimes(level === 'info' ? 1 : 0);
  });

  it('tries the full chain when the cooldown lookup fails', async () => {
    mgetMock.mockRejectedValueOnce(new Error('redis down'));
    generateTextMock.mockResolvedValueOnce(answer);

    const { model } = await run({ hedgeAfterMs: 1_000, attemptTimeoutMs: 10_000 });

    expect(model.model).toBe('model-a');
  });

  it('tries a model in cooldown after the rest of the chain', async () => {
    mgetMock.mockResolvedValue(['1', null]);
    generateTextMock.mockResolvedValueOnce(answer);

    const { model } = await run({ hedgeAfterMs: 1_000, attemptTimeoutMs: 10_000 });

    expect(model.model).toBe('model-b');
  });

  it('rejects with the last model error when a hedged model fails before the first one times out', async () => {
    const lastModelError = apiError({ statusCode: 400 });
    generateTextMock.mockImplementationOnce(pendingUntilAborted).mockRejectedValueOnce(lastModelError);

    const pending = run({ hedgeAfterMs: 1_000, attemptTimeoutMs: 5_000 });
    const rejection = expect(pending).rejects.toBe(lastModelError);
    await jest.advanceTimersByTimeAsync(5_000);

    await rejection;
  });

  it('does not bench a hedged model that was still running when the first one answered', async () => {
    generateTextMock
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(answer), 1_500)))
      .mockImplementationOnce(pendingUntilAborted);

    const pending = run({ hedgeAfterMs: 1_000, attemptTimeoutMs: 10_000 });
    await jest.advanceTimersByTimeAsync(1_500);
    const { model } = await pending;

    expect(model.model).toBe('model-a');
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it('aborts the earlier attempt when a later model wins', async () => {
    const signals: AbortSignal[] = [];
    generateTextMock.mockImplementation((args) => {
      signals.push(args.abortSignal);
      return signals.length === 1 ? pendingUntilAborted(args) : Promise.resolve(answer);
    });

    const pending = run({ hedgeAfterMs: 1_000, attemptTimeoutMs: 10_000 });
    await jest.advanceTimersByTimeAsync(999);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    const { model } = await pending;

    expect(model.model).toBe('model-b');
    expect(signals[0]!.aborted).toBe(true);
  });

  it('launches the next model and benches the one that timed out', async () => {
    generateTextMock.mockImplementationOnce(pendingUntilAborted).mockResolvedValueOnce(answer);

    const pending = run({ hedgeAfterMs: 60_000, attemptTimeoutMs: 5_000 });
    await jest.advanceTimersByTimeAsync(4_999);

    expect(generateTextMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    const { model } = await pending;

    expect(model.model).toBe('model-b');
    expect(redisClient.set).toHaveBeenCalledWith('ai_cooldown:anthropic:model-a', '1', 'EX', 120);
    expect(logger.info).toHaveBeenCalledWith(
      '[Test] Attempt failed',
      expect.objectContaining({ model: 'model-a', kind: 'timeout' }),
    );
  });
});
