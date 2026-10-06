enum TransactionStatus {
  SUCCESS = "SUCCESS",
  PENDING = "PENDING",
  FAILED = "FAILED",
  UNKNOWN = "UNKNOWN",
}

type BKTransaction = {
  sender?: string;
  beneficiary: string;
  debitedAccount: string;
  creditedAccount: string;
  amount: number;
  charge?: number;
  availableBalance?: number;
  status: TransactionStatus;
  date: Date;
};

export class BKSMSParser {
  public parseBKTransactionSMS(body: string): BKTransaction | null {
    const message = body.trim();

    if (!/^TRANSFER\b/i.test(message)) return null;

    const get = (regex: RegExp) => message.match(regex)?.[1]?.trim() ?? null;

    // Sender: <name> → stops at Beneficiary
    const sender = get(/Sender\s*:?\s*(.+?)(?=\s+Beneficiary\s*:)/i);

    // Beneficiary: <name> → stops at Credited account
    const beneficiary = get(
      /Beneficiary\s*:\s*(.+?)(?=\s+Credited\s+account\s*:)/i,
    );

    // Account number after the respective field
    const debitedAccount = get(/Debited\s+account\s*:\s*(\d+)/i);
    const creditedAccount = get(/Credited\s+account\s*:\s*(\d+)/i);

    // Supports Amount: 100 and Amount: RWF 40,000.00
    const amountRaw = get(/Amount\s*:\s*(?:RWF\s*)?([\d,\s]+(?:\.\d+)?)/i);

    // Optional fields
    const chargeRaw = get(
      /Transaction\s+Charge\s*:\s*(?:RWF\s*)?([\d,\s]+(?:\.\d+)?)/i,
    );

    const balanceRaw = get(
      /Available\s+Balance\s*:\s*(?:RWF\s*)?([\d,\s]+(?:\.\d+)?)/i,
    );

    // Status: <value> → stops at Date
    const status = get(/Status\s*:\s*(.+?)(?=\s+Date\s*:)/i);

    // Supports both "2026-10-05 18:30:36.557" and ISO-8601 dates
    const dateRaw = get(
      /Date\s*:\s*(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/i,
    );

    if (
      !beneficiary ||
      !debitedAccount ||
      !creditedAccount ||
      !amountRaw ||
      !status ||
      !dateRaw
    ) {
      return null;
    }

    const toNumber = (value: string) => {
      const number = Number(value.replace(/[,\s]/g, ""));
      return Number.isFinite(number) && number >= 0 ? number : NaN;
    };

    const amount = toNumber(amountRaw);
    const charge = chargeRaw ? toNumber(chargeRaw) : undefined;
    const availableBalance = balanceRaw ? toNumber(balanceRaw) : undefined;
    const date = new Date(dateRaw.replace(" ", "T"));

    if (
      amount === null ||
      (chargeRaw && charge === null) ||
      (balanceRaw && availableBalance === null) ||
      Number.isNaN(date.getTime())
    ) {
      return null;
    }

    return {
      sender: sender ?? undefined,
      beneficiary,
      debitedAccount,
      creditedAccount,
      amount,
      charge,
      availableBalance,
      status: status as TransactionStatus,
      date,
    };
  }
}
