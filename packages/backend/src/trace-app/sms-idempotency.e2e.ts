import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const momoReceived = ({ ftId, timestamp }: { ftId: string; timestamp: number }) => ({
  id: null,
  address: 'M-Money',
  body: `You have received 7000 RWF from John DOE (*****123) at 2026-01-10 07:12:49. Balance:7431 RWF. FT Id: ${ftId}.`,
  timestamp,
});

describe('POST /trace/migrate-sms-transactions idempotency', () => {
  const authenticate = async () => {
    const user = await helpers.getUserInfo({ raw: true });
    helpers.configureTraceAuth({ userId: user.id });
  };

  it('creates a transaction once and skips the same SMS when it is synced again', async () => {
    await authenticate();
    const mtnMomo = [momoReceived({ ftId: '10000000001', timestamp: 1000 })];

    const first = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });
    const second = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });

    expect(first.created).toBe(1);
    expect(first.duplicatesSkipped).toBe(0);
    expect(second.created).toBe(0);
    expect(second.duplicatesSkipped).toBe(1);

    const transactions = await helpers.getTransactions({ raw: true });
    expect(transactions.length).toBe(1);
    expect(transactions[0]!.originalId).toBe('10000000001');
  });

  it('skips repeated provider references inside one batch', async () => {
    await authenticate();
    const mtnMomo = [
      momoReceived({ ftId: '10000000002', timestamp: 1000 }),
      momoReceived({ ftId: '10000000002', timestamp: 2000 }),
      momoReceived({ ftId: '10000000003', timestamp: 3000 }),
    ];

    const result = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });

    expect(result.created).toBe(2);
    expect(result.duplicatesSkipped).toBe(1);
    expect((await helpers.getTransactions({ raw: true })).length).toBe(2);
  });

  it('returns zeros for an empty batch', async () => {
    await authenticate();

    const result = await helpers.migrateSmsTransactions({ raw: true });

    expect(result.created).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.failed).toEqual([]);
  });

  it('rejects a request with a wrong API key', async () => {
    await authenticate();

    const res = await helpers.migrateSmsTransactions({
      mtnMomo: [momoReceived({ ftId: '10000000004', timestamp: 1000 })],
      apiKey: 'wrong-key',
    });

    expect(res.statusCode).toBe(401);
    expect((await helpers.getTransactions({ raw: true })).length).toBe(0);
  });
});
