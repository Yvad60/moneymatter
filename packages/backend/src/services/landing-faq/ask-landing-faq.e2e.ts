import { AI_PROVIDER } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { redisClient } from '@root/redis-client';
import { buildCooldownKey } from '@services/ai/generate-text-with-fallback';
import * as helpers from '@tests/helpers';
import { ANTHROPIC_API_URL, VALID_ANTHROPIC_API_KEY, createAnthropicMock } from '@tests/mocks/anthropic/mock-api';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { createCallsCounter } from '@tests/mocks/helpers/calls-counter';

import {
  HEDGE_AFTER_MS,
  LANDING_FAQ_FALLBACK_MODEL,
  LANDING_FAQ_LAST_RESORT_MODEL,
  LANDING_FAQ_MODEL,
} from './ask-landing-faq.service';

const QUESTION = 'Can I self-host it?';

const modelReply = ({ answer, status = 'answered' }: { answer: string; status?: string }) =>
  JSON.stringify({ answer, status });

const fallbackAnswers = () =>
  createGeminiMock({
    rawText: modelReply({ answer: 'From the fallback.' }),
    expectedModel: LANDING_FAQ_FALLBACK_MODEL,
  });

describe('Landing FAQ assistant', () => {
  let faqKeyBeforeTest: string | undefined;
  let faqAnthropicKeyBeforeTest: string | undefined;
  let cookiesBeforeTest: string | null;

  beforeEach(() => {
    faqKeyBeforeTest = process.env.LANDING_FAQ_GEMINI_API_KEY;
    process.env.LANDING_FAQ_GEMINI_API_KEY = VALID_GEMINI_API_KEY;
    faqAnthropicKeyBeforeTest = process.env.LANDING_FAQ_ANTHROPIC_API_KEY;
    process.env.LANDING_FAQ_ANTHROPIC_API_KEY = VALID_ANTHROPIC_API_KEY;

    // Landing visitors have no session, so every request here goes out without the auth cookie.
    cookiesBeforeTest = global.APP_AUTH_COOKIES;
    global.APP_AUTH_COOKIES = null;
  });

  afterEach(() => {
    global.APP_AUTH_COOKIES = cookiesBeforeTest;

    if (faqKeyBeforeTest === undefined) {
      delete process.env.LANDING_FAQ_GEMINI_API_KEY;
    } else {
      process.env.LANDING_FAQ_GEMINI_API_KEY = faqKeyBeforeTest;
    }

    if (faqAnthropicKeyBeforeTest === undefined) {
      delete process.env.LANDING_FAQ_ANTHROPIC_API_KEY;
    } else {
      process.env.LANDING_FAQ_ANTHROPIC_API_KEY = faqAnthropicKeyBeforeTest;
    }
  });

  describe('POST /landing/faq/ask', () => {
    it('returns the model answer', async () => {
      global.mswMockServer.use(
        createAnthropicMock({ rawText: modelReply({ answer: '  Yes, with Docker Compose.  ' }) }),
      );

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'Yes, with Docker Compose.', status: 'answered' });
    });

    it.each([529, 429])('answers from the fallback model when the primary returns %i', async (errorStatus) => {
      const startedAt = Date.now();

      global.mswMockServer.use(createAnthropicMock({ shouldFail: true, errorStatus }), fallbackAnswers());

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the fallback.', status: 'answered' });
      // A failed primary starts the fallback at once, not after the hedge delay.
      expect(Date.now() - startedAt).toBeLessThan(HEDGE_AFTER_MS);
    });

    it('answers from the last-resort model when the primary and the fallback are both overloaded', async () => {
      const startedAt = Date.now();

      global.mswMockServer.use(
        createAnthropicMock({ shouldFail: true, errorStatus: 529 }),
        createGeminiMock({
          shouldFail: true,
          errorStatus: 503,
          expectedModel: LANDING_FAQ_FALLBACK_MODEL,
          passthroughOtherModels: true,
        }),
        createGeminiMock({
          rawText: modelReply({ answer: 'From the last resort.' }),
          expectedModel: LANDING_FAQ_LAST_RESORT_MODEL,
        }),
      );

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the last resort.', status: 'answered' });
      expect(Date.now() - startedAt).toBeLessThan(HEDGE_AFTER_MS);
    });

    it.each([
      ['does not match the answer schema', modelReply({ answer: 'Yes.', status: 'maybe' })],
      ['is empty', modelReply({ answer: '   ' })],
    ])('answers from the fallback model when the primary reply %s', async (_label, rawText) => {
      global.mswMockServer.use(createAnthropicMock({ rawText }), fallbackAnswers());

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the fallback.', status: 'answered' });
    });

    it(
      'answers from the fallback model when the primary is still silent after the hedge delay',
      async () => {
        global.mswMockServer.use(
          createAnthropicMock({
            rawText: modelReply({ answer: 'From the primary.' }),
            delayMs: HEDGE_AFTER_MS + 2_000,
          }),
          fallbackAnswers(),
        );

        const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

        expect(result).toEqual({ answer: 'From the fallback.', status: 'answered' });
      },
      HEDGE_AFTER_MS + 10_000,
    );

    it('waits for a primary that answers before the hedge delay', async () => {
      global.mswMockServer.use(
        createAnthropicMock({ rawText: modelReply({ answer: 'From the primary.' }), delayMs: 1_000 }),
        fallbackAnswers(),
      );

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the primary.', status: 'answered' });
    });

    it('answers from the fallback model when the Anthropic key is not configured', async () => {
      delete process.env.LANDING_FAQ_ANTHROPIC_API_KEY;
      global.mswMockServer.use(fallbackAnswers());

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the fallback.', status: 'answered' });
    });

    it.each(['unknown', 'off_topic'])('passes the %s status through', async (status) => {
      global.mswMockServer.use(createAnthropicMock({ rawText: modelReply({ answer: "I don't know.", status }) }));

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: "I don't know.", status });
    });

    it('returns 503 when no model reply matches the answer schema', async () => {
      const rawText = modelReply({ answer: 'Yes.', status: 'maybe' });

      global.mswMockServer.use(
        createAnthropicMock({ rawText }),
        createGeminiMock({ rawText, expectedModel: LANDING_FAQ_FALLBACK_MODEL, passthroughOtherModels: true }),
        createGeminiMock({ rawText, expectedModel: LANDING_FAQ_LAST_RESORT_MODEL }),
      );

      const res = await helpers.askLandingFaq({ question: QUESTION });

      expect(res.statusCode).toBe(503);
    });

    it('returns 503 when no landing FAQ key is configured', async () => {
      delete process.env.LANDING_FAQ_ANTHROPIC_API_KEY;
      delete process.env.LANDING_FAQ_GEMINI_API_KEY;

      const res = await helpers.askLandingFaq({ question: QUESTION });

      expect(res.statusCode).toBe(503);
    });

    it('returns 503 when every model fails', async () => {
      global.mswMockServer.use(
        createAnthropicMock({ shouldFail: true }),
        createGeminiMock({ shouldFail: true, expectedModel: LANDING_FAQ_FALLBACK_MODEL, passthroughOtherModels: true }),
        createGeminiMock({ shouldFail: true, expectedModel: LANDING_FAQ_LAST_RESORT_MODEL }),
      );

      const res = await helpers.askLandingFaq({ question: QUESTION });

      expect(res.statusCode).toBe(503);
    });

    it('returns 503 instead of an empty answer when no model emits visible text', async () => {
      const rawText = modelReply({ answer: '   ' });

      global.mswMockServer.use(
        createAnthropicMock({ rawText }),
        createGeminiMock({
          rawText,
          finishReason: 'MAX_TOKENS',
          expectedModel: LANDING_FAQ_FALLBACK_MODEL,
          passthroughOtherModels: true,
        }),
        createGeminiMock({ rawText, finishReason: 'MAX_TOKENS', expectedModel: LANDING_FAQ_LAST_RESORT_MODEL }),
      );

      const res = await helpers.askLandingFaq({ question: QUESTION });

      expect(res.statusCode).toBe(503);
    });

    it.each([
      ['too short', 'hi'],
      ['whitespace only', '     '],
      ['too long', 'a'.repeat(301)],
      ['not a string', 42],
      ['missing', undefined],
    ])('rejects a %s question with 422', async (_label, question) => {
      const res = await helpers.askLandingFaq({ question });

      expect(res.statusCode).toBe(422);
    });

    it('returns 429 after 10 questions from one IP, without counting rejected bodies', async () => {
      global.mswMockServer.use(createAnthropicMock({ rawText: modelReply({ answer: 'Answer.' }) }));

      const rejected = await helpers.askLandingFaq({ question: 'hi' });
      expect(rejected.statusCode).toBe(422);

      for (let i = 0; i < 10; i++) {
        const res = await helpers.askLandingFaq({ question: QUESTION });
        expect(res.statusCode).toBe(200);
      }

      const limited = await helpers.askLandingFaq({ question: QUESTION });

      expect(limited.statusCode).toBe(429);
      expect(limited.header['x-ratelimit-limit']).toBe('10');
    });

    it('limits each visitor behind the reverse proxy separately and ignores forged forwarded addresses', async () => {
      global.mswMockServer.use(createAnthropicMock({ rawText: modelReply({ answer: 'Answer.' }) }));

      for (let i = 0; i < 10; i++) {
        const res = await helpers.askLandingFaq({
          question: QUESTION,
          headers: { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.1` },
        });
        expect(res.statusCode).toBe(200);
      }

      const sameVisitor = await helpers.askLandingFaq({
        question: QUESTION,
        headers: { 'X-Forwarded-For': '198.51.100.99, 203.0.113.1' },
      });
      const otherVisitor = await helpers.askLandingFaq({
        question: QUESTION,
        headers: { 'X-Forwarded-For': '203.0.113.2' },
      });

      expect(sameVisitor.statusCode).toBe(429);
      expect(otherVisitor.statusCode).toBe(200);
    });

    it('returns 429 once the daily budget shared by all visitors is spent', async () => {
      global.mswMockServer.use(createAnthropicMock({ rawText: modelReply({ answer: 'Answer.' }) }));
      await redisClient.set('rate_limit:landing-faq:global', '1000', 'EX', 60);

      const limited = await helpers.askLandingFaq({ question: QUESTION });

      expect(limited.statusCode).toBe(429);
      expect(limited.header['x-ratelimit-limit']).toBe('1000');
    });
  });

  // Redis is flushed before every test, so a cooldown started here never reaches the next test.
  describe('model cooldown', () => {
    it.each([529, 503, 429])(
      'does not call a model that returned %i again on the next request within the cooldown',
      async (errorStatus) => {
        const primaryCalls = createCallsCounter(global.mswMockServer, ANTHROPIC_API_URL);
        global.mswMockServer.use(createAnthropicMock({ shouldFail: true, errorStatus }), fallbackAnswers());

        await helpers.askLandingFaq({ question: QUESTION, raw: true });

        const ttl = await redisClient.ttl(
          buildCooldownKey({ provider: AI_PROVIDER.anthropic, model: LANDING_FAQ_MODEL }),
        );
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(120);

        const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

        expect(result).toEqual({ answer: 'From the fallback.', status: 'answered' });
        expect(primaryCalls.count).toBe(1);
      },
    );

    it('calls a model again after a reply that did not match the answer schema', async () => {
      const primaryCalls = createCallsCounter(global.mswMockServer, ANTHROPIC_API_URL);
      global.mswMockServer.use(
        createAnthropicMock({ rawText: modelReply({ answer: 'Yes.', status: 'maybe' }) }),
        fallbackAnswers(),
      );

      await helpers.askLandingFaq({ question: QUESTION, raw: true });
      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the fallback.', status: 'answered' });
      expect(primaryCalls.count).toBe(2);
    });

    it(
      'does not call a model that stalled past the hedge delay again on the next request',
      async () => {
        const primaryCalls = createCallsCounter(global.mswMockServer, ANTHROPIC_API_URL);
        global.mswMockServer.use(
          createAnthropicMock({
            rawText: modelReply({ answer: 'From the primary.' }),
            delayMs: HEDGE_AFTER_MS + 2_000,
          }),
          fallbackAnswers(),
        );

        await helpers.askLandingFaq({ question: QUESTION, raw: true });
        const startedAt = Date.now();
        const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

        expect(result).toEqual({ answer: 'From the fallback.', status: 'answered' });
        expect(Date.now() - startedAt).toBeLessThan(HEDGE_AFTER_MS);
        expect(primaryCalls.count).toBe(1);
      },
      HEDGE_AFTER_MS + 10_000,
    );

    it('tries a model in cooldown last when the rest of the chain fails', async () => {
      const primaryCalls = createCallsCounter(global.mswMockServer, ANTHROPIC_API_URL);
      const geminiCalls = createCallsCounter(global.mswMockServer, /generativelanguage\.googleapis\.com/);
      global.mswMockServer.use(
        createAnthropicMock({ rawText: modelReply({ answer: 'From the primary.' }) }),
        createGeminiMock({
          shouldFail: true,
          errorStatus: 503,
          expectedModel: LANDING_FAQ_FALLBACK_MODEL,
          passthroughOtherModels: true,
        }),
        // 400 is not retried by the SDK, so the last resort fails without a backoff wait.
        createGeminiMock({ shouldFail: true, errorStatus: 400, expectedModel: LANDING_FAQ_LAST_RESORT_MODEL }),
      );
      await redisClient.set(
        buildCooldownKey({ provider: AI_PROVIDER.anthropic, model: LANDING_FAQ_MODEL }),
        '1',
        'EX',
        60,
      );

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the primary.', status: 'answered' });
      expect(primaryCalls.count).toBe(1);
      expect(geminiCalls.count).toBe(2);
    });

    it('keeps the chain order when every model is in cooldown', async () => {
      const primaryCalls = createCallsCounter(global.mswMockServer, ANTHROPIC_API_URL);
      global.mswMockServer.use(createAnthropicMock({ rawText: modelReply({ answer: 'From the primary.' }) }));

      for (const [provider, model] of [
        [AI_PROVIDER.anthropic, LANDING_FAQ_MODEL],
        [AI_PROVIDER.google, LANDING_FAQ_FALLBACK_MODEL],
        [AI_PROVIDER.google, LANDING_FAQ_LAST_RESORT_MODEL],
      ] as const) {
        await redisClient.set(buildCooldownKey({ provider, model }), '1', 'EX', 60);
      }

      const result = await helpers.askLandingFaq({ question: QUESTION, raw: true });

      expect(result).toEqual({ answer: 'From the primary.', status: 'answered' });
      expect(primaryCalls.count).toBe(1);
    });
  });
});
