import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as transactionsService from '@services/transactions/create-transaction';
import * as helpers from '@tests/helpers';
import { ConnectionError } from 'sequelize';

const momoReceived = ({ ftId, timestamp }: { ftId: string; timestamp: number }) => ({
  id: null,
  address: 'M-Money',
  body: `You have received 7000 RWF from John DOE (*****123) at 2026-01-10 07:12:49. Balance:7431 RWF. FT Id: ${ftId}.`,
  timestamp,
});

const momoTransferWithoutId = ({ timestamp }: { timestamp: number }) => ({
  id: null,
  address: 'M-Money',
  body: '*165*S*15500 RWF transferred to Alex MUKAMANA (250788000111) at 2026-01-10 12:02:14 .Fee: 250RWF.Balance: 1181RWF.Dial *182*1*3# and send money abroad *RW#',
  timestamp,
});

const momoPaymentWithFee = ({ txId, timestamp }: { txId: string; timestamp: number }) => ({
  id: null,
  address: 'M-Money',
  body: `TxId:${txId}*S*Your payment of 1,450 RWF to CITY MARKET LTD 200002 was completed at 2026-01-11 08:11:39.  Balance: 1,211 RWF. Fee 250 RWF.*EN#`,
  timestamp,
});

const authenticate = async () => {
  const user = await helpers.getUserInfo({ raw: true });
  helpers.configureTraceAuth({ userId: user.id });
};

describe('POST /trace/migrate-sms-transactions idempotency', () => {
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

  it('skips an SMS without a provider reference when the same moment, amount and direction already exists', async () => {
    await authenticate();
    const mtnMomo = [momoTransferWithoutId({ timestamp: 1000 })];

    const first = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });
    const second = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });

    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(second.duplicatesSkipped).toBe(2);
    expect((await helpers.getTransactions({ raw: true })).length).toBe(2);
  });

  it('skips repeated SMS without a provider reference inside one batch', async () => {
    await authenticate();
    const mtnMomo = [momoTransferWithoutId({ timestamp: 1000 }), momoTransferWithoutId({ timestamp: 1000 })];

    const result = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });

    expect(result.created).toBe(2);
    expect(result.duplicatesSkipped).toBe(2);
    expect((await helpers.getTransactions({ raw: true })).length).toBe(2);
  });

  it('books the fee as a separate expense on the same account, keyed off the SMS reference', async () => {
    await authenticate();
    const mtnMomo = [momoPaymentWithFee({ txId: '10000000020', timestamp: 20000 })];

    const result = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });
    expect(result.created).toBe(2);

    const transactions = await helpers.getTransactions({ raw: true });
    const payment = transactions.find((tx) => tx.originalId === '10000000020');
    const fee = transactions.find((tx) => tx.originalId === '10000000020:fee');

    expect(payment?.amount).toBe(1450);
    expect(payment?.transactionType).toBe('expense');
    expect(payment?.categoryId).toBeFalsy();
    expect(fee?.amount).toBe(250);
    expect(fee?.transactionType).toBe('expense');
    expect(fee?.categoryId).toBeTruthy();
    expect(fee?.accountId).toBe(payment?.accountId);
    expect(fee?.note?.startsWith('Fee · ')).toBe(true);

    const resynced = await helpers.migrateSmsTransactions({ mtnMomo, raw: true });
    expect(resynced.created).toBe(0);
    expect(resynced.duplicatesSkipped).toBe(2);
  });

  describe('failure handling', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('holds the sync time before a message that failed on a connection error', async () => {
      await authenticate();
      const original = transactionsService.createTransaction;
      jest.spyOn(transactionsService, 'createTransaction').mockImplementation(async (params) => {
        if (params.originalId === '10000000008') throw new ConnectionError(new Error('db down'));
        return original(params);
      });

      const result = await helpers.migrateSmsTransactions({
        mtnMomo: [
          momoReceived({ ftId: '10000000007', timestamp: 7000 }),
          momoReceived({ ftId: '10000000008', timestamp: 8000 }),
          momoReceived({ ftId: '10000000009', timestamp: 9000 }),
        ],
        raw: true,
      });

      expect(result.created).toBe(2);
      expect(result.failed.length).toBe(1);
      expect((await helpers.getLatestSmsSyncTime({ raw: true })).latestTime).toBe(7999);
    });

    it('moves the sync time past a message that failed for a non-retryable reason', async () => {
      await authenticate();
      const original = transactionsService.createTransaction;
      jest.spyOn(transactionsService, 'createTransaction').mockImplementation(async (params) => {
        if (params.originalId === '10000000011') throw new Error('rejected');
        return original(params);
      });

      const result = await helpers.migrateSmsTransactions({
        mtnMomo: [
          momoReceived({ ftId: '10000000010', timestamp: 10000 }),
          momoReceived({ ftId: '10000000011', timestamp: 11000 }),
        ],
        raw: true,
      });

      expect(result.failed.length).toBe(1);
      expect((await helpers.getLatestSmsSyncTime({ raw: true })).latestTime).toBe(11000);
    });
  });

  describe('advanceCursor', () => {
    it('moves the sync time forward by default', async () => {
      await authenticate();

      await helpers.migrateSmsTransactions({
        mtnMomo: [momoReceived({ ftId: '10000000005', timestamp: 5000 })],
        raw: true,
      });

      expect((await helpers.getLatestSmsSyncTime({ raw: true })).latestTime).toBe(5000);
    });

    it('leaves the sync time untouched when advanceCursor is false', async () => {
      await authenticate();

      const result = await helpers.migrateSmsTransactions({
        mtnMomo: [momoReceived({ ftId: '10000000006', timestamp: 6000 })],
        advanceCursor: false,
        raw: true,
      });

      expect(result.created).toBe(1);
      expect((await helpers.getLatestSmsSyncTime({ raw: true })).latestTime).toBeNull();
    });
  });
});
