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
import * as accountsService from '@services/accounts.service';
import * as transactionsService from '@services/transactions';

import { type CreateTransactionInternal } from '../../serializers';
import { BkSmsParser } from '../parsers/bk.parser';
import { MtnMomoSmsParser } from '../parsers/mtn-momo.parser';
import { type SMSTransaction, type SMSTransactionType } from '../parsers/sms-parser.shared';

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

  const existingAccounts = await Accounts.getAccounts({ userId, type: ACCOUNT_TYPES.system });
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
    ...bk.map((message) => ({ source: 'bk' as const, original: message, parsed: bkParser.parse(message.body) })),
    ...mtnMomo.map((message) => ({
      source: 'mtnMomo' as const,
      original: message,
      parsed: mtnMomoParser.parse(message.body),
    })),
  ];
}

export function convertParsedSmsToAppTransaction({
  parsedMessage,
  userId,
  accountId,
}: {
  parsedMessage: SMSTransaction;
  userId: number;
  accountId: RecordId;
}): CreateTransactionInternal {
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
  };
}

export async function migrateSmsTransactions({
  userId,
  mtnMomo,
  bk,
}: {
  userId: number;
  mtnMomo: RawSmsMessage[];
  bk: RawSmsMessage[];
}) {
  const migrated = parseMessages({ mtnMomo, bk });

  const accountIdBySource: Record<SmsSource, RecordId> = {
    mtnMomo: await resolveSmsSourceAccountId({ userId, source: 'mtnMomo' }),
    bk: await resolveSmsSourceAccountId({ userId, source: 'bk' }),
  };

  const results = await Promise.all(
    migrated
      .filter((entry): entry is typeof entry & { parsed: SMSTransaction } => entry.parsed !== null)
      .map(async (entry) => {
        const params = convertParsedSmsToAppTransaction({
          parsedMessage: entry.parsed,
          userId,
          accountId: accountIdBySource[entry.source],
        });

        try {
          await transactionsService.createTransaction(params);
          return { success: true as const, original: entry.original };
        } catch (error) {
          return { success: false as const, original: entry.original, error: (error as Error).message };
        }
      }),
  );

  return {
    status: true,
    created: results.filter((result) => result.success).length,
    failed: results.filter(
      (result): result is { success: false; original: RawSmsMessage; error: string } => !result.success,
    ),
  };
}
