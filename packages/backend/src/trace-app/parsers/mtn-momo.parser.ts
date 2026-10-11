import { logger } from "@js/utils/logger";

import type { Parser, SMSTransaction } from "./sms-parser.shared";
import {
  getRequiredGroups,
  isValidTransaction,
  normalizeMessage,
  parseAmount,
} from "./sms-parser.shared";

export type { SMSTransaction, SMSTransactionType } from "./sms-parser.shared";

export class MtnMomoSmsParser {
  private readonly parsers: Parser[];

  constructor() {
    this.parsers = [
      this.parseReceivedFromBank,
      this.parseReceivedMoney,
      this.parsePayment,
      this.parseTransfer,
      this.parseMokash,
      this.parseMerchantTransaction,
    ];
  }

  parse(message: string): SMSTransaction | null {
    const normalizedMessage = normalizeMessage(message);

    for (const parser of this.parsers) {
      try {
        const transaction = parser.call(this, normalizedMessage);

        if (transaction && isValidTransaction(transaction)) {
          return transaction;
        }
      } catch (error) {
        // A malformed SMS should never crash the import; log and try the next parser.
        logger.error({
          message: `MtnMomoSmsParser: sub-parser "${parser.name}" threw while parsing an SMS`,
          error: error as Error,
        });
      }
    }

    return null;
  }

  parseMany(messages: string[]): {
    parsed: SMSTransaction[];
    unparsed: string[];
  } {
    const parsed: SMSTransaction[] = [];
    const unparsed: string[] = [];

    for (const message of messages) {
      const transaction = this.parse(message);

      if (transaction) {
        parsed.push(transaction);
      } else {
        unparsed.push(message);
      }
    }

    return {
      parsed,
      unparsed,
    };
  }

  // ===========================================================================
  // RECEIVED MONEY
  // ===========================================================================

  private parseReceivedMoney(message: string): SMSTransaction | null {
    const match = message.match(
      /You have received\s+(?<amount>[\d,]+)\s+RWF\s+from\s+(?<senderName>.+?)\s+\((?<senderAccount>[^)]+)\)\s+at\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\s*\.\s*(?:Message from sender:.*?\.\s*)?Balance:\s*(?<balance>[\d,]+)\s+RWF\.\s*FT Id:\s*(?<transactionId>\d+)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "amount",
      "senderName",
      "senderAccount",
      "date",
      "time",
      "balance",
      "transactionId",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const balance = parseAmount(groups.balance);
    const date = this.parseDate(groups.date, groups.time);

    if (amount === null || balance === null || date === null) {
      return null;
    }

    return {
      type: "received",
      amount,
      currency: "RWF",
      date,
      balance,
      fee: 0,
      transactionId: groups.transactionId,
      sender: {
        name: groups.senderName,
        account: groups.senderAccount,
      },
      rawMessage: message,
      parser: "received-money-v1",
    };
  }

  // ===========================================================================
  // RECEIVED FROM BANK
  // ===========================================================================

  private parseReceivedFromBank(message: string): SMSTransaction | null {
    const match = message.match(
      /You have received\s+(?<amount>[\d,]+)\s+RWF\s+from\s+(?<senderName>.+?)\s+\((?<senderMaskedAccount>[^)]+)\)\s+at\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\.\s*Message from sender:\s*Sender:(?<metadataSender>.*?),AcctId:(?<accountId>[^,]+),FSPId:(?<fspId>[^,]+),FSP:(?<fsp>.*?)\.\s*Balance:\s*(?<balance>[\d,]+)\s+RWF\.\s*FT Id:\s*(?<transactionId>\d+)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "amount",
      "senderName",
      "senderMaskedAccount",
      "date",
      "time",
      "metadataSender",
      "accountId",
      "balance",
      "transactionId",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const balance = parseAmount(groups.balance);
    const date = this.parseDate(groups.date, groups.time);

    if (amount === null || balance === null || date === null) {
      return null;
    }

    return {
      type: "received",
      amount,
      currency: "RWF",
      date,
      balance,
      fee: 0,
      transactionId: groups.transactionId,
      sender: {
        name: groups.metadataSender || groups.senderName,
        account: groups.accountId || groups.senderMaskedAccount,
      },
      rawMessage: message,
      parser: "received-bank-v1",
    };
  }

  // ===========================================================================
  // PAYMENT
  // ===========================================================================

  private parsePayment(message: string): SMSTransaction | null {
    const match = message.match(
      /TxId:(?<transactionId>\d+)\s*\*S\*Your payment of\s+(?<amount>[\d,]+)\s+RWF\s+to\s+(?<recipient>.+?)\s+(?:with token\b.*?\s+)?was completed at\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\.\s*(?:Balance:\s*(?<balance>[\d,]+)\s+RWF\.\s*Fee\s+(?<fee>[\d,]+)\s+RWF|Fee\s+(?<feeAlt>[\d,]+)\s+RWF\.\s*Balance:\s*(?<balanceAlt>[\d,]+)\s+RWF)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "transactionId",
      "amount",
      "recipient",
      "date",
      "time",
    ] as const);

    if (!groups) {
      return null;
    }

    const balanceRaw = match?.groups?.balance ?? match?.groups?.balanceAlt;
    const feeRaw = match?.groups?.fee ?? match?.groups?.feeAlt;

    if (!balanceRaw || !feeRaw) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const balance = parseAmount(balanceRaw);
    const fee = parseAmount(feeRaw);
    const date = this.parseDate(groups.date, groups.time);

    if (amount === null || balance === null || fee === null || date === null) {
      return null;
    }

    return {
      type: "payment",
      amount,
      currency: "RWF",
      date,
      balance,
      fee,
      transactionId: groups.transactionId,
      recipient: this.parseRecipient(groups.recipient),
      rawMessage: message,
      parser: "payment-v1",
    };
  }

  // ===========================================================================
  // TRANSFER
  // ===========================================================================

  private parseTransfer(message: string): SMSTransaction | null {
    const match = message.match(
      /\*165\*S\*(?<amount>[\d,]+)\s+RWF\s+transferred to\s+(?<recipientName>.+?)\s+\((?<recipientAccount>[^)]+)\)\s+at\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\s*\.?\s*Fee:\s*(?<fee>[\d,]+)\s*RWF\.\s*Balance:\s*(?<balance>[\d,]+)\s*RWF/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "amount",
      "recipientName",
      "recipientAccount",
      "date",
      "time",
      "fee",
      "balance",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const balance = parseAmount(groups.balance);
    const fee = parseAmount(groups.fee);
    const date = this.parseDate(groups.date, groups.time);

    if (amount === null || balance === null || fee === null || date === null) {
      return null;
    }

    return {
      type: "transfer",
      amount,
      currency: "RWF",
      date,
      balance,
      fee,
      recipient: {
        name: groups.recipientName,
        account: groups.recipientAccount,
      },
      rawMessage: message,
      parser: "transfer-v1",
    };
  }

  // ===========================================================================
  // MOKASH
  // ===========================================================================

  private parseMokash(message: string): SMSTransaction | null {
    const match = message.match(
      /\*164\*S\*Y'ello,\s*A transaction of\s+(?<amount>[\d,]+)\s+RWF\s+by\s+Mokash Savings Account\s+was completed at\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\.\s*Balance:\s*(?<balance>[\d,]+)\s+RWF\.\s*Fee\s+(?<fee>[\d,]+)\s+RWF\.\s*FT Id:\s*(?<transactionId>\d+)\.\s*ET\s+Id:\s*(?<externalTransactionId>\d+)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "amount",
      "date",
      "time",
      "balance",
      "fee",
      "transactionId",
      "externalTransactionId",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const balance = parseAmount(groups.balance);
    const fee = parseAmount(groups.fee);
    const date = this.parseDate(groups.date, groups.time);

    if (amount === null || balance === null || fee === null || date === null) {
      return null;
    }

    return {
      type: "savings",
      amount,
      currency: "RWF",
      date,
      balance,
      fee,
      transactionId: groups.transactionId,
      rawMessage: message,
      parser: "mokash-v1",
    };
  }

  private parseMerchantTransaction(message: string): SMSTransaction | null {
    const match = message.match(
      /\*164\*S\*Y'ello,\s*A transaction of\s+(?<amount>[\d,]+)\s+RWF\s+by\s+(?<recipient>.+?)\s+was completed at\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\.\s*Balance:\s*(?<balance>[\d,]+)\s+RWF\.\s*Fee\s+(?<fee>[\d,]+)\s+RWF\.\s*FT Id:\s*(?<transactionId>\d+)\.\s*ET\s+Id:\s*(?<externalTransactionId>\d+)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "amount",
      "recipient",
      "date",
      "time",
      "balance",
      "fee",
      "transactionId",
      "externalTransactionId",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const balance = parseAmount(groups.balance);
    const fee = parseAmount(groups.fee);
    const date = this.parseDate(groups.date, groups.time);

    if (amount === null || balance === null || fee === null || date === null) {
      return null;
    }

    return {
      type: "payment",
      amount,
      currency: "RWF",
      date,
      balance,
      fee,
      transactionId: groups.transactionId,
      recipient: {
        name: groups.recipient,
      },
      rawMessage: message,
      parser: "merchant-transaction-v1",
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private parseDate(date: string, time: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return null;
    }

    if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) {
      return null;
    }

    const parsed = new Date(`${date}T${time}`);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  private parseRecipient(value: string): {
    name?: string;
    account?: string;
  } {
    const cleaned = value.trim();

    const match = cleaned.match(/^(.+?)\s+(\d{5,})$/);

    if (!match) {
      return {
        name: cleaned,
      };
    }

    const name = match[1];
    const account = match[2];

    if (!name || !account) {
      return {
        name: cleaned,
      };
    }

    return {
      name: name.trim(),
      account: account.trim(),
    };
  }
}
