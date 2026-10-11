import { describe, expect, it } from "@jest/globals";

import { MtnMomoSmsParser } from "../parsers/mtn-momo.parser";

describe("MobileMoneySmsParser", () => {
  const parser = new MtnMomoSmsParser();

  it("parses a received-money SMS", () => {
    const message =
      "You have received 7000 RWF from John DOE (*****123) at 2026-01-10 07:12:49. Balance:7431 RWF. FT Id: 10000000001.";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "received",
      amount: 7000,
      currency: "RWF",
      balance: 7431,
      fee: 0,
      transactionId: "10000000001",
      sender: {
        name: "John DOE",
        account: "*****123",
      },
      parser: "received-money-v1",
    });
    expect(transaction?.date).toEqual(new Date("2026-01-10T07:12:49"));
  });

  it("parses a received-money SMS with a stray space before the period", () => {
    const message =
      "You have received 3000 RWF from John DOE (*****123) at 2026-01-10 07:12:49 . Balance:7431 RWF. FT Id: 10000000001.";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "received",
      amount: 3000,
      currency: "RWF",
      balance: 7431,
      fee: 0,
      transactionId: "10000000001",
      sender: {
        name: "John DOE",
        account: "*****123",
      },
      parser: "received-money-v1",
    });
    expect(transaction?.date).toEqual(new Date("2026-01-10T07:12:49"));
  });

  it("parses a received-money SMS with a free-text sender message", () => {
    const message =
      "You have received 100000 RWF from Example Loan Account (*****625) at 2026-01-10 11:40:43. Message from sender: receivermessage. Balance:110541 RWF. FT Id: 10000000006.";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "received",
      amount: 100000,
      currency: "RWF",
      balance: 110541,
      fee: 0,
      transactionId: "10000000006",
      sender: {
        name: "Example Loan Account",
        account: "*****625",
      },
      parser: "received-money-v1",
    });
    expect(transaction?.date).toEqual(new Date("2026-01-10T11:40:43"));
  });

  it("parses a payment-to-person SMS and splits the trailing account number", () => {
    const message =
      "TxId:10000000002*S*Your payment of 7,000 RWF to Jane 100001 was completed at 2026-01-10 07:13:05.  Balance: 431 RWF. Fee 0 RWF.*EN#";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "payment",
      amount: 7000,
      currency: "RWF",
      balance: 431,
      fee: 0,
      transactionId: "10000000002",
      recipient: {
        name: "Jane",
        account: "100001",
      },
      parser: "payment-v1",
    });
  });

  it("parses a payment-to-business SMS with Fee before Balance and a token/ET Id segment", () => {
    const message =
      "*162*TxId:10000000007*S*Your payment of 12000 RWF to MTN Cash Power with token 11111-22222-33333-44444 and ET Id: 11111-22222-33333-44444 abc12345-6789-0abc-def0-123456789abc was completed at 2026-10-02 08:31:53. Fee 0 RWF. Balance: 3891 RWF . Message: - Electricity units: 47.0kwH.. *RW#";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "payment",
      amount: 12000,
      currency: "RWF",
      balance: 3891,
      fee: 0,
      transactionId: "10000000007",
      recipient: {
        name: "MTN Cash Power",
      },
      parser: "payment-v1",
    });
    expect(transaction?.date).toEqual(new Date("2026-10-02T08:31:53"));
  });

  it("parses a transfer SMS to another mobile number", () => {
    const message =
      "*165*S*15500 RWF transferred to Alex MUKAMANA (250788000111) at 2026-01-10 12:02:14 .Fee: 250RWF.Balance: 1181RWF.Dial *182*1*3# and send money abroad *RW#";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "transfer",
      amount: 15500,
      currency: "RWF",
      balance: 1181,
      fee: 250,
      recipient: {
        name: "Alex MUKAMANA",
        account: "250788000111",
      },
      parser: "transfer-v1",
    });
  });

  it("parses a payment-to-business SMS and splits the trailing account number", () => {
    const message =
      "TxId:10000000003*S*Your payment of 1,450 RWF to CITY MARKET LTD 200002 was completed at 2026-01-11 08:11:39.  Balance: 1,211 RWF. Fee 0 RWF.*EN#";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "payment",
      amount: 1450,
      currency: "RWF",
      balance: 1211,
      fee: 0,
      transactionId: "10000000003",
      recipient: {
        name: "CITY MARKET LTD",
        account: "200002",
      },
      parser: "payment-v1",
    });
  });

  it("parses a received-from-bank SMS and prefers the sender metadata over the masked account", () => {
    const message =
      "You have received 40000 RWF from JANE SMITH (*****456) at 2026-01-11 18:30:41. Message from sender: Sender:JANE SMITH,AcctId:100000000001,FSPId:040,FSP:Example Bank. Balance:41631 RWF. FT Id: 10000000004.";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "received",
      amount: 40000,
      currency: "RWF",
      balance: 41631,
      fee: 0,
      transactionId: "10000000004",
      sender: {
        name: "JANE SMITH",
        account: "100000000001",
      },
      parser: "received-bank-v1",
    });
  });

  it("parses a Mokash savings SMS", () => {
    const message =
      "*164*S*Y'ello, A transaction of 2000 RWF by Mokash Savings Account was completed at 2026-01-12 17:11:56. Balance:2871 RWF. Fee  0 RWF. FT Id: 10000000005. ET  Id: 2026011200000001.*RW#";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "savings",
      amount: 2000,
      currency: "RWF",
      balance: 2871,
      fee: 0,
      transactionId: "10000000005",
      parser: "mokash-v1",
    });
  });

  it("parses a generic merchant transaction SMS as a payment", () => {
    const message =
      "*164*S*Y'ello, A transaction of 500 RWF by ACME UTILITIES LTD was completed at 2026-09-17 19:55:43. Balance:2361 RWF. Fee  0 RWF. FT Id: 30634145805. ET  Id: 10000000008.*RW#";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "payment",
      amount: 500,
      currency: "RWF",
      balance: 2361,
      fee: 0,
      transactionId: "30634145805",
      recipient: {
        name: "ACME UTILITIES LTD",
      },
      parser: "merchant-transaction-v1",
    });
  });

  it("returns null for an unrecognized message", () => {
    const transaction = parser.parse(
      "Your OTP code is 123456. Do not share it with anyone.",
    );

    expect(transaction).toBeNull();
  });

  it("buckets messages into parsed and unparsed via parseMany", () => {
    const received =
      "You have received 7000 RWF from John DOE (*****123) at 2026-01-10 07:12:49. Balance:7431 RWF. FT Id: 10000000001.";
    const garbage = "Your OTP code is 123456. Do not share it with anyone.";

    const { parsed, unparsed } = parser.parseMany([received, garbage]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      type: "received",
      transactionId: "10000000001",
    });
    expect(unparsed).toEqual([garbage]);
  });
});
