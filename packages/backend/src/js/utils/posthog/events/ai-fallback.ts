import type { AI_PROVIDER } from '@bt/shared/types';

import { trackEvent } from '../index';

export type AiAttemptFailureKind =
  | 'rate_limited'
  | 'overloaded'
  | 'server_error'
  | 'timeout'
  | 'stalled_past_hedge'
  | 'invalid_output'
  | 'other';

// Outages are not tied to a user; one shared distinct id keeps PostHog from creating a
// person profile per event.
const SERVER_DISTINCT_ID = 'server';
const SERVER_EVENT_PROPERTIES = { $process_person_profile: false };

interface AiModelAttempt {
  feature: string;
  provider: AI_PROVIDER;
  model: string;
  chainPosition: number;
  durationMs: number;
}

export function trackAiModelAttemptFailed({
  feature,
  provider,
  model,
  chainPosition,
  durationMs,
  failureKind,
  httpStatus,
  cooldownStarted,
  answeredBy,
}: AiModelAttempt & {
  failureKind: AiAttemptFailureKind;
  httpStatus: number | null;
  cooldownStarted: boolean;
  answeredBy: string | null;
}): void {
  trackEvent({
    userId: SERVER_DISTINCT_ID,
    event: 'ai_model_attempt_failed',
    properties: {
      ...SERVER_EVENT_PROPERTIES,
      feature,
      provider,
      model,
      chain_position: chainPosition,
      duration_ms: durationMs,
      failure_kind: failureKind,
      http_status: httpStatus,
      cooldown_started: cooldownStarted,
      answered_by: answeredBy,
    },
  });
}

/** One per answered request, for the winning model. */
export function trackAiModelAnswered({
  feature,
  provider,
  model,
  chainPosition,
  durationMs,
  failedAttempts,
}: AiModelAttempt & { failedAttempts: number }): void {
  trackEvent({
    userId: SERVER_DISTINCT_ID,
    event: 'ai_model_answered',
    properties: {
      ...SERVER_EVENT_PROPERTIES,
      feature,
      provider,
      model,
      chain_position: chainPosition,
      duration_ms: durationMs,
      failed_attempts: failedAttempts,
    },
  });
}
