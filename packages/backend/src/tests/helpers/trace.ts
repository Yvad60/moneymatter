import type { migrateSmsTransactions as apiMigrateSmsTransactions } from '../../trace-app/services/migrate-sms.service';
import { makeRequest } from './common';

type RawSmsMessage = { id: string | null; address: string; body: string; timestamp: number };

export const TRACE_TEST_API_KEY = 'trace-test-api-key';

/** Points the API-key auth at the default test user; call before any trace request. */
export function configureTraceAuth({ userId }: { userId: number }) {
  process.env.TRACE_API_KEY = TRACE_TEST_API_KEY;
  process.env.TRACE_USER_ID = String(userId);
}

export function migrateSmsTransactions<R extends boolean | undefined = undefined>({
  mtnMomo = [],
  bk = [],
  apiKey = TRACE_TEST_API_KEY,
  raw,
}: {
  mtnMomo?: RawSmsMessage[];
  bk?: RawSmsMessage[];
  apiKey?: string;
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiMigrateSmsTransactions>>, R>({
    method: 'post',
    url: '/trace/migrate-sms-transactions',
    payload: { mtnMomo, bk },
    headers: { 'x-api-key': apiKey },
    raw,
  });
}

export function getLatestSmsSyncTime<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<{ latestTime: number | null }, R>({
    method: 'get',
    url: '/trace/latest-sync-time',
    headers: { 'x-api-key': TRACE_TEST_API_KEY },
    raw,
  });
}
