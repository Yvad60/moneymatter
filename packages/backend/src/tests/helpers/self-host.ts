import { afterAll, beforeAll } from '@jest/globals';

/** Runs every test in the file as a self-hosted instance, e.g. to reach providers closed on cloud. */
export function useSelfHost(): void {
  let flagBeforeTests: string | undefined;

  beforeAll(() => {
    flagBeforeTests = process.env.IS_SELF_HOST;
    process.env.IS_SELF_HOST = 'true';
  });

  afterAll(() => {
    if (flagBeforeTests === undefined) {
      delete process.env.IS_SELF_HOST;
    } else {
      process.env.IS_SELF_HOST = flagBeforeTests;
    }
  });
}
