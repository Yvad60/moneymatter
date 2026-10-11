import { describe, expect, it } from "@jest/globals";

import { BkSmsParser } from "../parsers/bk.parser";

describe("BkSmsParser", () => {
  const parser = new BkSmsParser();

  it("parses an EKASH outgoing transfer SMS", () => {
    const message =
      "TRANSFER - EKASH Beneficiary: Jane DOE Credited account: 0788000001 Debited account: 100000000001 Amount:RWF 5000.00 Transaction Charge:RWF 20 Event #:FTCM00000000001 Status: COMPLETED Date: 2026-10-06 21:07:40.541 Channel:USSD Available Balance:RWF 1,159 For enquiry call BK:250788143000/4455";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "transfer",
      amount: 5000,
      currency: "RWF",
      balance: 1159,
      fee: 20,
      transactionId: "FTCM00000000001",
      sender: {
        account: "100000000001",
      },
      recipient: {
        name: "Jane DOE",
        account: "0788000001",
      },
      parser: "bk-ekash-transfer-v1",
    });
    expect(transaction?.date).toEqual(new Date("2026-10-06T21:07:40"));
  });

  it("parses an EKASH outgoing transfer SMS with a multi-word channel", () => {
    const message =
      "TRANSFER - EKASH Beneficiary: Jane DOE Credited account: 0788000001 Debited account: 100000000001 Amount:RWF 4000.00 Transaction Charge:RWF 20 Event #:FTCM00000000005 Status: COMPLETED Date: 2026-10-06 13:46:10.515 Channel:INTERNET BANKING Available Balance:RWF 6,079 For enquiry call BK:250788143000/4455";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "transfer",
      amount: 4000,
      currency: "RWF",
      balance: 6079,
      fee: 20,
      transactionId: "FTCM00000000005",
      sender: {
        account: "100000000001",
      },
      recipient: {
        name: "Jane DOE",
        account: "0788000001",
      },
      parser: "bk-ekash-transfer-v1",
    });
    expect(transaction?.date).toEqual(new Date("2026-10-06T13:46:10"));
  });

  it("parses an EKASH incoming transfer SMS with an ISO8601 offset date", () => {
    const message =
      "TRANSFER - EKASH Sender John SMITH Beneficiary: JOHN SMITH Credited account: 002600000000001 Debited account: 250788000002 Amount: 100.00 Event #: FTCM00000000002Status: COMPLETED Date: 2026-10-06T19:08:56+02:00";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "received",
      amount: 100,
      currency: "RWF",
      fee: 0,
      transactionId: "FTCM00000000002",
      sender: {
        name: "John SMITH",
        account: "250788000002",
      },
      recipient: {
        name: "JOHN SMITH",
        account: "002600000000001",
      },
      parser: "bk-ekash-received-v1",
    });
    expect(transaction?.balance).toBeUndefined();
    expect(transaction?.date).toEqual(new Date("2026-10-06T19:08:56+02:00"));
  });

  it("parses a Bank of Kigali internal transfer SMS with a US-style date", () => {
    const message =
      "TRANSFER - Bank of Kigali Credited account: 002600000000001  Debited account: 100000000003  Amount: RWF 10,000 Transaction Charge: RWF 0 Event #: FTCM00000000003  Status: COMPLETED Date: 10/6/26, 1:43 PM  Channel:INTERNET_BANKING Available Balance:  RWF 40,000 For enquiry call BK: 250788143000 / 4455";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "transfer",
      amount: 10000,
      currency: "RWF",
      balance: 40000,
      fee: 0,
      transactionId: "FTCM00000000003",
      sender: {
        account: "100000000003",
      },
      recipient: {
        account: "002600000000001",
      },
      parser: "bk-internal-transfer-v1",
    });
    expect(transaction?.date).toEqual(new Date(2026, 9, 6, 13, 43, 0));
  });

  it("parses a French-language credit notification SMS", () => {
    const message =
      "Cher/Chère JANE DOE, votre compte ********0001 a été crédité de RWF250,000. Réf : FTCM00000000006 le 28-09-2026 07:39:16. Description de la transaction : EKASH incoming transfer. Frais de transaction : RWF0. Frais de notification : RWF0. Solde disponible : RWF255,309. Pour toute demande d information, appelez BK : 250788143000.";

    const transaction = parser.parse(message);

    expect(transaction).toMatchObject({
      type: "received",
      amount: 250000,
      currency: "RWF",
      balance: 255309,
      fee: 0,
      transactionId: "FTCM00000000006",
      recipient: {
        name: "JANE DOE",
        account: "********0001",
      },
      parser: "bk-french-credit-v1",
    });
    expect(transaction?.date).toEqual(new Date("2026-09-28T07:39:16"));
  });

  it("returns null for an unrecognized message", () => {
    const transaction = parser.parse(
      "Your OTP code is 123456. Do not share it with anyone.",
    );

    expect(transaction).toBeNull();
  });

  it("buckets messages into parsed and unparsed via parseMany", () => {
    const transfer =
      "TRANSFER - EKASH Beneficiary: Jane DOE Credited account: 0788000001 Debited account: 100000000001 Amount:RWF 5000.00 Transaction Charge:RWF 20 Event #:FTCM00000000001 Status: COMPLETED Date: 2026-10-06 21:07:40.541 Channel:USSD Available Balance:RWF 1,159 For enquiry call BK:250788143000/4455";
    const garbage = "Your OTP code is 123456. Do not share it with anyone.";

    const { parsed, unparsed } = parser.parseMany([transfer, garbage]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      type: "transfer",
      transactionId: "FTCM00000000001",
    });
    expect(unparsed).toEqual([garbage]);
  });
});
