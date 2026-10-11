export type SMSTransactionType =
  | "received"
  | "payment"
  | "transfer"
  | "savings";

export interface SMSTransaction {
  type: SMSTransactionType;
  amount: number;
  currency: "RWF";
  date: Date;
  balance?: number;
  fee: number;
  transactionId?: string;

  sender?: {
    name?: string;
    account?: string;
  };

  recipient?: {
    name?: string;
    account?: string;
  };

  rawMessage: string;
  parser: string;
}

export type Parser = (message: string) => SMSTransaction | null;

export type RegexGroups = Record<string, string | undefined>;

export function normalizeMessage(message: string): string {
  return message
    .replace(/\r\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Safely extracts required regex groups.
 *
 * This ensures that after this function returns a non-null value,
 * every requested group is known to be a string.
 */
export function getRequiredGroups<T extends readonly string[]>(
  groups: RegexGroups | undefined,
  required: T,
): { [K in T[number]]: string } | null {
  if (!groups) {
    return null;
  }

  const result = {} as { [K in T[number]]: string };

  for (const name of required) {
    const value = groups[name];

    if (value === undefined || value.trim() === "") {
      return null;
    }

    result[name as T[number]] = value.trim();
  }

  return result;
}

export function parseAmount(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;

  return amount;
}

export function isValidTransaction(transaction: SMSTransaction): boolean {
  if (!Number.isFinite(transaction.amount)) return false;

  if (
    transaction.balance !== undefined &&
    !Number.isFinite(transaction.balance)
  ) {
    return false;
  }

  if (!Number.isFinite(transaction.fee)) return false;
  if (transaction.amount < 0) return false;

  if (transaction.balance !== undefined && transaction.balance < 0)
    return false;

  if (transaction.fee < 0) return false;

  if (transaction.currency !== "RWF") return false;

  if (Number.isNaN(transaction.date.getTime())) {
    return false;
  }

  if (!transaction.rawMessage.trim()) {
    return false;
  }

  if (!transaction.parser.trim()) {
    return false;
  }

  return true;
}
