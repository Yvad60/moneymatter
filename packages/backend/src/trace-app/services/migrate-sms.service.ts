import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type RecordId,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import * as Accounts from '@models/accounts.model';
import * as Transactions from '@models/transactions.model';
import * as accountsService from '@services/accounts.service';
import * as transactionsService from '@services/transactions';
import { ConnectionError, TimeoutError, UniqueConstraintError } from 'sequelize';

import { type CreateTransactionInternal } from '../../serializers';
import { BkSmsParser } from '../parsers/bk.parser';
import { MtnMomoSmsParser } from '../parsers/mtn-momo.parser';
import { type SMSTransaction, type SMSTransactionType } from '../parsers/sms-parser.shared';
import { advanceLatestSmsSyncTimestamp } from './sms-sync-state.service';

/**
 * None of these SMS types resolve to a destination account inside the app
 * (we only ever see one leg of the movement), so everything is booked as a
 * plain income/expense rather than a transfer.
 */
const SMS_TYPE_TO_TRANSACTION_TYPE: Record<SMSTransactionType, TRANSACTION_TYPES> = {
  received: TRANSACTION_TYPES.income,
  payment: TRANSACTION_TYPES.expense,
  transfer: TRANSACTION_TYPES.expense,
  savings: TRANSACTION_TYPES.expense,
};

type SmsSource = 'mtnMomo' | 'bk';

/** `externalId` convention used to find the one system account each SMS
 *  source books against, independent of what the user later renames it to. */
const SMS_SOURCE_ACCOUNT: Record<SmsSource, { externalId: string; name: string }> = {
  mtnMomo: { externalId: 'sms-source:mtnMomo', name: 'MTN Mobile Money' },
  bk: { externalId: 'sms-source:bk', name: 'Bank of Kigali' },
};

const SMS_CURRENCY_CODE = 'RWF';

/**
 * Finds the conventional per-user system account for an SMS source
 * (`"sms-source:mtnMomo"` / `"sms-source:bk"` by `externalId`), creating it
 * with a zero opening balance the first time this user syncs from that
 * source. Keeps account resolution out of the client: the mobile app only
 * ever sends raw SMS text, never an accountId.
 */
async function resolveSmsSourceAccountId({ userId, source }: { userId: number; source: SmsSource }): Promise<RecordId> {
  const { externalId, name } = SMS_SOURCE_ACCOUNT[source];

  const existingAccounts = await Accounts.getAccounts({
    userId,
    type: ACCOUNT_TYPES.system,
  });
  const existing = existingAccounts.find((account) => account.externalId === externalId);
  if (existing) return existing.id as RecordId;

  const created = await accountsService.createAccount({
    userId,
    type: ACCOUNT_TYPES.system,
    accountCategory: ACCOUNT_CATEGORIES.general,
    currencyCode: SMS_CURRENCY_CODE,
    name,
    externalId,
    initialBalance: Money.zero(),
    creditLimit: Money.zero(),
  });

  if (!created) {
    throw new Error(`Failed to resolve or create SMS source account "${name}" for user ${userId}`);
  }

  return created.id as RecordId;
}

type RawSmsMessage = {
  id: string | null;
  address: string;
  body: string;
  timestamp: number;
};

function parseMessages({ mtnMomo, bk }: { mtnMomo: RawSmsMessage[]; bk: RawSmsMessage[] }) {
  const bkParser = new BkSmsParser();
  const mtnMomoParser = new MtnMomoSmsParser();

  return [
    ...bk.map((message) => ({
      source: 'bk' as const,
      original: message,
      parsed: bkParser.parse(message.body),
    })),
    ...mtnMomo.map((message) => ({
      source: 'mtnMomo' as const,
      original: message,
      parsed: mtnMomoParser.parse(message.body),
    })),
  ];
}

function convertParsedSmsToAppTransaction({
  parsedMessage,
  source,
  userId,
  accountId,
}: {
  parsedMessage: SMSTransaction;
  source: SmsSource;
  userId: number;
  accountId: RecordId;
}): CreateTransactionInternal & {
  originalId?: string;
  externalData: Record<string, unknown>;
} {
  return {
    userId,
    accountId,
    amount: Money.fromDecimal(parsedMessage.amount),
    commissionRate: Money.fromDecimal(parsedMessage.fee),
    transactionType: SMS_TYPE_TO_TRANSACTION_TYPE[parsedMessage.type],
    paymentType: PAYMENT_TYPES.mobilePayment,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    time: parsedMessage.date,
    note: parsedMessage.rawMessage,
    // The provider's own reference is stable across devices and re-reads of the same SMS.
    // Messages without one rely on the sync-time cursor alone.
    originalId: parsedMessage.transactionId,
    externalData: { sms: { source } },
  };
}

const toKey = ({ accountId, originalId }: { accountId: RecordId; originalId: string }) => `${accountId}:${originalId}`;

const toFingerprint = ({
  accountId,
  time,
  amountCents,
  transactionType,
}: {
  accountId: RecordId;
  time: Date;
  amountCents: number;
  transactionType: TRANSACTION_TYPES;
}) => `${accountId}:${time.getTime()}:${amountCents}:${transactionType}`;

/**
 * `advanceCursor: false` is for single live messages delivered out of band: they must not move the
 * sync time past older messages the device has not uploaded yet.
 */
export async function migrateSmsTransactions({
  userId,
  mtnMomo,
  bk,
  advanceCursor = true,
}: {
  userId: number;
  mtnMomo: RawSmsMessage[];
  bk: RawSmsMessage[];
  advanceCursor?: boolean;
}) {
  const migrated = parseMessages({ mtnMomo, bk });

  const accountIdBySource: Record<SmsSource, RecordId> = {
    mtnMomo: await resolveSmsSourceAccountId({ userId, source: 'mtnMomo' }),
    bk: await resolveSmsSourceAccountId({ userId, source: 'bk' }),
  };

  const parsedEntries = migrated
    .filter((entry): entry is typeof entry & { parsed: SMSTransaction } => entry.parsed !== null)
    .map((entry) => ({ ...entry, accountId: accountIdBySource[entry.source] }));

  const incomingIds = parsedEntries.flatMap((entry) =>
    entry.parsed.transactionId ? [entry.parsed.transactionId] : [],
  );
  const existing =
    incomingIds.length > 0
      ? await Transactions.getTransactionsByArrayOfField({
          fieldName: 'originalId',
          fieldValues: incomingIds,
          userId,
        })
      : [];
  const seenKeys = new Set(
    existing.map((tx) => toKey({ accountId: tx.accountId as RecordId, originalId: tx.originalId })),
  );

  const entriesWithoutId = parsedEntries.filter((entry) => !entry.parsed.transactionId);
  const existingWithoutId =
    entriesWithoutId.length > 0
      ? await Transactions.getTransactionsByArrayOfField({
          fieldName: 'time',
          fieldValues: entriesWithoutId.map((entry) => entry.parsed.date),
          userId,
        })
      : [];
  const seenFingerprints = new Set(
    existingWithoutId.map((tx) =>
      toFingerprint({
        accountId: tx.accountId as RecordId,
        time: new Date(tx.time),
        amountCents: tx.amount.toCents(),
        transactionType: tx.transactionType,
      }),
    ),
  );

  let duplicatesSkipped = 0;
  const entriesToCreate = parsedEntries.filter((entry) => {
    const originalId = entry.parsed.transactionId;
    if (!originalId) {
      // Without a provider reference, the same moment, amount and direction on one account is the same SMS.
      const fingerprint = toFingerprint({
        accountId: entry.accountId,
        time: entry.parsed.date,
        amountCents: Money.fromDecimal(entry.parsed.amount).toCents(),
        transactionType: SMS_TYPE_TO_TRANSACTION_TYPE[entry.parsed.type],
      });
      if (seenFingerprints.has(fingerprint)) {
        duplicatesSkipped += 1;
        return false;
      }
      seenFingerprints.add(fingerprint);
      return true;
    }

    const key = toKey({ accountId: entry.accountId, originalId });
    if (seenKeys.has(key)) {
      duplicatesSkipped += 1;
      return false;
    }
    seenKeys.add(key);
    return true;
  });

  const results = await Promise.all(
    entriesToCreate.map(async (entry) => {
      const params = convertParsedSmsToAppTransaction({
        parsedMessage: entry.parsed,
        source: entry.source,
        userId,
        accountId: entry.accountId,
      });

      try {
        await transactionsService.createTransaction(params);
        return { success: true as const, original: entry.original };
      } catch (error) {
        // Lost a race with a concurrent sync that booked the same provider reference.
        if (error instanceof UniqueConstraintError) {
          return { success: true as const, duplicate: true as const, original: entry.original };
        }
        return {
          success: false as const,
          original: entry.original,
          error: (error as Error).message,
          retryable: error instanceof ConnectionError || error instanceof TimeoutError,
        };
      }
    }),
  );

  const raceDuplicates = results.filter((result) => 'duplicate' in result).length;
  duplicatesSkipped += raceDuplicates;

  // Unparseable or rejected messages never succeed on retry, so they must not hold the cursor back.
  // Infrastructure errors (db connection, timeout) do succeed later, so the cursor stops before them.
  const retryableTimestamps = results.flatMap((result) =>
    !result.success && result.retryable ? [result.original.timestamp] : [],
  );
  const newestTimestamp = Math.max(...[...mtnMomo, ...bk].map((message) => message.timestamp));
  const cursorTimestamp =
    retryableTimestamps.length > 0 ? Math.min(newestTimestamp, Math.min(...retryableTimestamps) - 1) : newestTimestamp;
  if (advanceCursor && Number.isFinite(cursorTimestamp)) {
    await advanceLatestSmsSyncTimestamp({ userId, timestamp: cursorTimestamp });
  }

  return {
    status: true,
    created: results.filter((result) => result.success && !('duplicate' in result)).length,
    duplicatesSkipped,
    failed: results.filter(
      (result): result is { success: false; original: RawSmsMessage; error: string; retryable: boolean } =>
        !result.success,
    ),
  };
}
