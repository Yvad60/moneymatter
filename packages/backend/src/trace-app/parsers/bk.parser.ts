import { logger } from "@js/utils/logger";

import type { Parser, SMSTransaction } from "./sms-parser.shared";
import {
  getRequiredGroups,
  isValidTransaction,
  normalizeMessage,
  parseAmount,
} from "./sms-parser.shared";

export class BkSmsParser {
  private readonly parsers: Parser[];

  constructor() {
    this.parsers = [
      this.parseEkashReceived,
      this.parseEkashTransfer,
      this.parseBankTransfer,
      this.parseFrenchCredit,
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
          message: `BkSmsParser: sub-parser "${parser.name}" threw while parsing an SMS`,
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
  // EKASH - OUTGOING TRANSFER (TRANSFER - EKASH Beneficiary: ...)
  // ===========================================================================

  private parseEkashTransfer(message: string): SMSTransaction | null {
    const match = message.match(
      /TRANSFER\s*-\s*EKASH\s+Beneficiary:\s*(?<recipientName>.+?)\s*Credited account:\s*(?<recipientAccount>\S+)\s*Debited account:\s*(?<senderAccount>\S+)\s*Amount:\s*RWF\s*(?<amount>[\d,]+(?:\.\d+)?)\s*Transaction Charge:\s*RWF\s*(?<fee>[\d,]+(?:\.\d+)?)\s*Event\s*#:\s*(?<transactionId>\S+?)\s*Status:\s*COMPLETED\s*Date:\s*(?<date>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*Channel:.+?\s*Available Balance:\s*RWF\s*(?<balance>[\d,]+(?:\.\d+)?)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "recipientName",
      "recipientAccount",
      "senderAccount",
      "amount",
      "fee",
      "transactionId",
      "date",
      "balance",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const fee = parseAmount(groups.fee);
    const balance = parseAmount(groups.balance);
    const date = this.parseBkDate(groups.date);

    if (amount === null || fee === null || balance === null || date === null) {
      return null;
    }

    return {
      type: "transfer",
      amount,
      currency: "RWF",
      date,
      balance,
      fee,
      transactionId: groups.transactionId,
      sender: {
        account: groups.senderAccount,
      },
      recipient: {
        name: groups.recipientName,
        account: groups.recipientAccount,
      },
      rawMessage: message,
      parser: "bk-ekash-transfer-v1",
    };
  }

  // ===========================================================================
  // EKASH - INCOMING TRANSFER (TRANSFER - EKASH Sender ... Beneficiary: ...)
  // ===========================================================================

  private parseEkashReceived(message: string): SMSTransaction | null {
    const match = message.match(
      /TRANSFER\s*-\s*EKASH\s+Sender\s+(?<senderName>.+?)\s*Beneficiary:\s*(?<recipientName>.+?)\s*Credited account:\s*(?<recipientAccount>\S+)\s*Debited account:\s*(?<senderAccount>\S+)\s*Amount:\s*(?:RWF\s*)?(?<amount>[\d,]+(?:\.\d+)?)\s*Event\s*#:\s*(?<transactionId>\S+?)\s*Status:\s*COMPLETED\s*Date:\s*(?<date>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "senderName",
      "senderAccount",
      "recipientName",
      "recipientAccount",
      "amount",
      "transactionId",
      "date",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const date = this.parseBkDate(groups.date);

    if (amount === null || date === null) {
      return null;
    }

    return {
      type: "received",
      amount,
      currency: "RWF",
      date,
      fee: 0,
      transactionId: groups.transactionId,
      sender: {
        name: groups.senderName,
        account: groups.senderAccount,
      },
      recipient: {
        name: groups.recipientName,
        account: groups.recipientAccount,
      },
      rawMessage: message,
      parser: "bk-ekash-received-v1",
    };
  }

  // ===========================================================================
  // BANK OF KIGALI - INTERNAL TRANSFER (TRANSFER - Bank of Kigali ...)
  // ===========================================================================

  private parseBankTransfer(message: string): SMSTransaction | null {
    const match = message.match(
      /TRANSFER\s*-\s*Bank of Kigali\s+Credited account:\s*(?<recipientAccount>\S+)\s*Debited account:\s*(?<senderAccount>\S+)\s*Amount:\s*RWF\s*(?<amount>[\d,]+(?:\.\d+)?)\s*Transaction Charge:\s*RWF\s*(?<fee>[\d,]+(?:\.\d+)?)\s*Event\s*#:\s*(?<transactionId>\S+?)\s*Status:\s*COMPLETED\s*Date:\s*(?<date>\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}\s*[AP]M)\s*Channel:\S+\s*Available Balance:\s*RWF\s*(?<balance>[\d,]+(?:\.\d+)?)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "recipientAccount",
      "senderAccount",
      "amount",
      "fee",
      "transactionId",
      "date",
      "balance",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const fee = parseAmount(groups.fee);
    const balance = parseAmount(groups.balance);
    const date = this.parseBkDate(groups.date);

    if (amount === null || fee === null || balance === null || date === null) {
      return null;
    }

    return {
      type: "transfer",
      amount,
      currency: "RWF",
      date,
      balance,
      fee,
      transactionId: groups.transactionId,
      sender: {
        account: groups.senderAccount,
      },
      recipient: {
        account: groups.recipientAccount,
      },
      rawMessage: message,
      parser: "bk-internal-transfer-v1",
    };
  }

  // ===========================================================================
  // FRENCH CREDIT NOTIFICATION (Cher/Chère ..., votre compte ... a été crédité ...)
  // ===========================================================================

  private parseFrenchCredit(message: string): SMSTransaction | null {
    const match = message.match(
      /Cher\/Chère\s+(?<recipientName>.+?),\s*votre compte\s*(?<recipientAccount>\S+)\s*a été crédité de\s*RWF\s*(?<amount>[\d,]+(?:\.\d+)?)\.\s*Réf\s*:\s*(?<transactionId>\S+)\s*le\s*(?<date>\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})\.\s*Description de la transaction\s*:\s*.+?\.\s*Frais de transaction\s*:\s*RWF\s*(?<fee>[\d,]+(?:\.\d+)?)\.\s*Frais de notification\s*:\s*RWF\s*[\d,]+(?:\.\d+)?\.\s*Solde disponible\s*:\s*RWF\s*(?<balance>[\d,]+(?:\.\d+)?)/i,
    );

    const groups = getRequiredGroups(match?.groups, [
      "recipientName",
      "recipientAccount",
      "amount",
      "transactionId",
      "date",
      "fee",
      "balance",
    ] as const);

    if (!groups) {
      return null;
    }

    const amount = parseAmount(groups.amount);
    const fee = parseAmount(groups.fee);
    const balance = parseAmount(groups.balance);
    const date = this.parseBkDate(groups.date);

    if (amount === null || fee === null || balance === null || date === null) {
      return null;
    }

    return {
      type: "received",
      amount,
      currency: "RWF",
      date,
      balance,
      fee,
      transactionId: groups.transactionId,
      recipient: {
        name: groups.recipientName,
        account: groups.recipientAccount,
      },
      rawMessage: message,
      parser: "bk-french-credit-v1",
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private parseBkDate(raw: string): Date | null {
    const trimmed = raw.trim();

    const withMillis = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/,
    );

    if (withMillis) {
      const [, year, month, day, hour, minute, second] = withMillis;
      const parsed = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}`,
      );

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(trimmed)) {
      const parsed = new Date(trimmed);

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const frenchFormat = trimmed.match(
      /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/,
    );

    if (frenchFormat) {
      const [, day, month, year, hour, minute, second] = frenchFormat;
      const parsed = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}`,
      );

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const usFormat = trimmed.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*(\d{1,2}):(\d{2})\s*([AP]M)$/i,
    );

    if (usFormat) {
      const [, month, day, year, hourRaw, minute, meridiem] = usFormat;

      if (!month || !day || !year || !hourRaw || !minute || !meridiem) {
        return null;
      }

      let hour = Number(hourRaw) % 12;

      if (meridiem.toUpperCase() === "PM") {
        hour += 12;
      }

      const fullYear = 2000 + Number(year);
      const parsed = new Date(
        fullYear,
        Number(month) - 1,
        Number(day),
        hour,
        Number(minute),
        0,
      );

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }
}
