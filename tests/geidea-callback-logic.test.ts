/**
 * Geidea callback: decoding, money canonicalisation, and classification,
 * against the shape Geidea actually sends.
 *
 * The fixture is a redacted, structurally faithful copy of a real test
 * callback captured on 21 September 2026: the same top-level keys, the same
 * order keys that matter, both transactions with their `codes`, and the
 * sensitive material a real callback carries (masked card, cardholder name,
 * card token, 3DS token, Geidea's copy of the public key), all replaced by
 * obvious fixture values. The pure half of the callback is tested here
 * without a fake of anything; the route's own tests cover the composition.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_CALLBACK_BYTES,
  PAID_CODES,
  amountsMatch,
  canonicalAmount,
  classifyCallback,
  codesArePaid,
  decodeCallbackPayload,
  failureReasonFor,
  inquiryDisagreement,
  isPaidCallback,
  isPaidStatus,
  latestPayCodes,
  paidTransaction,
  providerStatusSummary,
} from "../lib/payments/geidea/callback.ts";
import type { GeideaCallbackPayload } from "../lib/payments/geidea/callback.ts";

const ORDER_ID = "3f433da9-2d20-4243-4fd2-08df0df6399e";
const REF = "5fde430a-4ed5-4876-9929-11871c32ff8b";
const SESSION_ID = "043ad7ca-9e38-474e-f09e-08def275479c";
const AUTH_TX = "888b7f89-52c7-4511-6245-08df0df639c7";
const PAY_TX = "0ff34eca-d4b6-44bc-624e-08df0df639c7";
const SIG = "3emO3dXo2WRXgsUTTTLV9hAucY7KA7mEDqn6Lfzh+xE=";
const TIMESTAMP = "09/21/2026 19:06:52";

const SENSITIVE = {
  maskedCardNumber: "446404******0007",
  cardholderName: "Test User",
  tokenId: "3bd75222-05dc-4059-9770-08def08c9c62",
  authenticationToken: "mHyn+7YFi1EUAREAAAAvNUe6Hv8=",
  merchantPublicKey: "00000000-0000-4000-8000-000000000000",
};

const paidCodes = {
  acquirerCode: "00",
  acquirerMessage: "Approved",
  ...PAID_CODES,
};

const paymentMethod = {
  type: "Card",
  brand: "mada",
  cardholderName: SENSITIVE.cardholderName,
  maskedCardNumber: SENSITIVE.maskedCardNumber,
  wallet: null,
  expiryDate: { month: 1, year: 39 },
  issuingCountry: "SAU",
  fundingType: "DEBIT",
};

const authenticationTx = (over: Record<string, unknown> = {}) => ({
  transactionId: AUTH_TX,
  type: "Authentication",
  status: "Success",
  amount: 1.0,
  currency: "SAR",
  source: "HPP",
  paymentMethod,
  codes: { ...paidCodes, acquirerCode: null, acquirerMessage: null },
  authenticationDetails: {
    authenticationToken: SENSITIVE.authenticationToken,
    transactionStatus: "Y",
    protocolVersion: "2.2.0",
  },
  tokenId: SENSITIVE.tokenId,
  ...over,
});

const payTx = (over: Record<string, unknown> = {}, codes: Record<string, unknown> = {}) => ({
  transactionId: PAY_TX,
  type: "Pay",
  status: "Success",
  amount: 1.0,
  currency: "SAR",
  source: "HPP",
  authorizationCode: "091025",
  rrn: "626419091025",
  paymentMethod,
  codes: { ...paidCodes, ...codes },
  ...over,
});

/** The captured callback, redacted. `order` and `top` override; `pay` null removes the Pay transaction. */
function raw(over: {
  order?: Record<string, unknown>;
  top?: Record<string, unknown>;
  pay?: Record<string, unknown> | null;
  payCodes?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const transactions = [authenticationTx(), ...(over.pay === null ? [] : [payTx(over.pay ?? {}, over.payCodes ?? {})])];
  const order = {
    merchantId: "2a223a37-cacf-4250-e159-08df1164618d",
    orderId: ORDER_ID,
    amount: 1.0,
    tipAmount: 0.0,
    convenienceFeeAmount: 0.0,
    totalAmount: 1.0,
    settleAmount: 1.0,
    currency: "SAR",
    settleCurrency: "SAR",
    language: "en",
    detailedStatus: "Paid",
    status: "Success",
    threeDSecureId: AUTH_TX,
    merchantPublicKey: SENSITIVE.merchantPublicKey,
    parentOrderId: null,
    merchantReferenceId: REF,
    mcc: "5734",
    callbackUrl: "https://webhook.example.test/test-token",
    billingAddress: { countryCode: null, street: null, city: null, postCode: null, state: null },
    shippingAddress: { countryCode: null, street: null, city: null, postCode: null, state: null },
    returnUrl: null,
    cardOnFile: false,
    tokenId: null,
    initiatedBy: "Internet",
    paymentOperation: "Pay",
    transactions,
    orderItems: [],
    isTokenPayment: false,
    paymentMethod,
    totalAuthorizedAmount: 1.0,
    totalCapturedAmount: 1.0,
    totalRefundedAmount: 0,
    isTest: true,
    gatewayDecision: "Reject",
    customerName: null,
    customerEmail: null,
    sessionId: SESSION_ID,
    createdDate: "2026-09-21T19:06:24.7448004",
    updatedDate: "2026-09-21T19:06:49.6645403",
    ...over.order,
  };
  return { order, signature: SIG, timeStamp: TIMESTAMP, sessionId: SESSION_ID, ...over.top };
}

function decoded(over: Parameters<typeof raw>[0] = {}): GeideaCallbackPayload {
  const result = decodeCallbackPayload(raw(over));
  assert.ok(result.ok, `fixture must decode: ${JSON.stringify(result)}`);
  return result.payload;
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

describe("decodeCallbackPayload: the real shape", () => {
  test("keeps exactly the fields the route reads, and nothing else", () => {
    const payload = decoded();
    assert.deepEqual(payload, {
      order: {
        orderId: ORDER_ID,
        amount: 1.0,
        currency: "SAR",
        status: "Success",
        detailedStatus: "Paid",
        merchantReferenceId: REF,
        sessionId: SESSION_ID,
        isTest: true,
        paymentOperation: "Pay",
        transactions: [
          {
            type: "Authentication",
            status: "Success",
            amount: 1.0,
            codes: {
              responseCode: "000",
              responseMessage: "Success",
              detailedResponseCode: "000",
              detailedResponseMessage: "The operation was successful",
            },
          },
          {
            type: "Pay",
            status: "Success",
            amount: 1.0,
            codes: {
              responseCode: "000",
              responseMessage: "Success",
              detailedResponseCode: "000",
              detailedResponseMessage: "The operation was successful",
            },
          },
        ],
      },
      signature: SIG,
      timeStamp: TIMESTAMP,
      sessionId: SESSION_ID,
    });
  });

  test("drops every sensitive field a real callback carries", () => {
    const text = JSON.stringify(decoded());
    for (const value of Object.values(SENSITIVE)) assert.ok(!text.includes(value), value);
    for (const key of ["paymentMethod", "authenticationDetails", "tokenId", "merchantPublicKey", "customerEmail", "gatewayDecision", "acquirerCode", "rrn", "authorizationCode", "merchantId"]) {
      assert.ok(!text.includes(`"${key}"`), key);
    }
  });

  test("accepts the amount as a number or as a decimal string, unchanged", () => {
    assert.equal(decoded({ order: { amount: "1.00" } }).order.amount, "1.00");
    assert.equal(decoded({ order: { amount: 1850 } }).order.amount, 1850);
    assert.equal(decoded({ pay: { amount: "1.00" } }).order.transactions[1].amount, "1.00");
  });

  test("optional fields decode to null when absent, and transactions to an empty list", () => {
    const payload = decoded({
      order: { detailedStatus: undefined, sessionId: undefined, isTest: undefined, paymentOperation: undefined, transactions: undefined },
      top: { sessionId: undefined },
    });
    assert.equal(payload.order.detailedStatus, null);
    assert.equal(payload.order.sessionId, null);
    assert.equal(payload.order.isTest, null);
    assert.equal(payload.order.paymentOperation, null);
    assert.deepEqual(payload.order.transactions, []);
    assert.equal(payload.sessionId, null);
    const noCodes = decoded({ pay: { codes: undefined, amount: undefined } });
    assert.equal(noCodes.order.transactions[1].codes, null);
    assert.equal(noCodes.order.transactions[1].amount, null);
  });

  test("refuses everything that is not the documented shape, naming the path", () => {
    const cases: [string, unknown, string][] = [
      ["null", null, "$"],
      ["a string", "x", "$"],
      ["an array", [raw()], "$"],
      ["no order", raw({ top: { order: undefined } }), "$.order"],
      ["orderId not a UUID", raw({ order: { orderId: "42" } }), "$.order.orderId"],
      ["orderId with a path", raw({ order: { orderId: `${ORDER_ID}/../x` } }), "$.order.orderId"],
      ["amount missing", raw({ order: { amount: undefined } }), "$.order.amount"],
      ["amount three decimals", raw({ order: { amount: 1.005 } }), "$.order.amount"],
      ["amount zero", raw({ order: { amount: 0 } }), "$.order.amount"],
      ["amount text", raw({ order: { amount: "abc" } }), "$.order.amount"],
      ["amount Arabic-Indic", raw({ order: { amount: "١٫٠٠" } }), "$.order.amount"],
      ["currency lower-case", raw({ order: { currency: "sar" } }), "$.order.currency"],
      ["currency too long", raw({ order: { currency: "SAUD" } }), "$.order.currency"],
      ["status missing", raw({ order: { status: undefined } }), "$.order.status"],
      ["status overlong", raw({ order: { status: "S".repeat(65) } }), "$.order.status"],
      ["detailedStatus not a string", raw({ order: { detailedStatus: 1 } }), "$.order.detailedStatus"],
      ["reference not a UUID", raw({ order: { merchantReferenceId: "ref-1" } }), "$.order.merchantReferenceId"],
      ["order sessionId not a UUID", raw({ order: { sessionId: "sess-1" } }), "$.order.sessionId"],
      ["isTest not a boolean", raw({ order: { isTest: "true" } }), "$.order.isTest"],
      ["paymentOperation overlong", raw({ order: { paymentOperation: "P".repeat(33) } }), "$.order.paymentOperation"],
      ["transactions not an array", raw({ order: { transactions: {} } }), "$.order.transactions"],
      ["a transaction not an object", raw({ order: { transactions: ["x"] } }), "$.order.transactions[0]"],
      ["a transaction without a type", raw({ pay: { type: undefined } }), "$.order.transactions[1].type"],
      ["a transaction without a status", raw({ pay: { status: undefined } }), "$.order.transactions[1].status"],
      ["a transaction amount unreadable", raw({ pay: { amount: "abc" } }), "$.order.transactions[1].amount"],
      ["codes not an object", raw({ pay: { codes: "000" } }), "$.order.transactions[1].codes"],
      ["responseCode overlong", raw({ payCodes: { responseCode: "0".repeat(9) } }), "$.order.transactions[1].codes.responseCode"],
      ["responseMessage overlong", raw({ payCodes: { responseMessage: "x".repeat(201) } }), "$.order.transactions[1].codes.responseMessage"],
      ["signature missing", raw({ top: { signature: undefined } }), "$.signature"],
      ["signature overlong", raw({ top: { signature: "A".repeat(129) } }), "$.signature"],
      ["timeStamp missing", raw({ top: { timeStamp: undefined } }), "$.timeStamp"],
      ["top-level sessionId not a UUID", raw({ top: { sessionId: "x" } }), "$.sessionId"],
    ];
    for (const [name, input, path] of cases) {
      const result = decodeCallbackPayload(input);
      assert.equal(result.ok, false, name);
      if (!result.ok) assert.equal(result.path, path, name);
    }
  });

  test("a body size limit exists and comfortably fits a real callback", () => {
    assert.ok(MAX_CALLBACK_BYTES <= 128 * 1024);
    assert.ok(MAX_CALLBACK_BYTES >= 32 * 1024, "a real callback is around ten kilobytes");
    assert.ok(JSON.stringify(raw()).length < MAX_CALLBACK_BYTES / 4);
  });
});

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

describe("canonicalAmount and amountsMatch: two-decimal strings, never floats", () => {
  class FakeDecimal {
    readonly value: string;
    constructor(value: string) {
      this.value = value;
    }
    toString() {
      return this.value;
    }
  }

  test("numbers, decimal strings and Decimal-like objects canonicalise identically", () => {
    assert.equal(canonicalAmount(1), "1.00");
    assert.equal(canonicalAmount(1.0), "1.00");
    assert.equal(canonicalAmount("1.00"), "1.00");
    assert.equal(canonicalAmount("19.9"), "19.90");
    assert.equal(canonicalAmount(1850), "1850.00");
    assert.equal(canonicalAmount(new FakeDecimal("49.5")), "49.50");
    assert.equal(canonicalAmount(new FakeDecimal("1")), "1.00");
  });

  test("anything the money formatter refuses is null", () => {
    for (const value of [19.999, 0, -1, "abc", "", null, undefined, true, {}, [19.99], new Date(0), NaN]) {
      assert.equal(canonicalAmount(value), null, String(value));
    }
  });

  test("amountsMatch compares canonical strings and never two unreadable values", () => {
    assert.equal(amountsMatch(1, new FakeDecimal("1.00")), true);
    assert.equal(amountsMatch("19.9", 19.9), true);
    assert.equal(amountsMatch(19.99, "19.98"), false);
    assert.equal(amountsMatch("abc", "abc"), false, "two failures are not a match");
    assert.equal(amountsMatch(null, null), false);
  });

  test("the module never does float arithmetic on money", () => {
    const src = readFileSync(new URL("../lib/payments/geidea/callback.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/Math\.(abs|round|floor|ceil)/.test(src));
    assert.ok(!/parseFloat|Number\(/.test(src));
    assert.ok(!/amount\s*[-+*/]/.test(src));
  });
});

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

describe("classifyCallback: paid needs the order and the Pay transaction to agree", () => {
  test("the captured paid callback is paid", () => {
    const payload = decoded();
    assert.equal(classifyCallback(payload), "paid");
    assert.equal(isPaidCallback(payload), true);
    assert.equal(paidTransaction(payload.order)?.type, "Pay");
    assert.deepEqual(latestPayCodes(payload.order), { ...PAID_CODES });
    assert.equal(classifyCallback(decoded({ order: { paymentOperation: undefined } })), "paid");
  });

  test("any single missing success value means not paid", () => {
    const notPaid: [string, Parameters<typeof raw>[0]][] = [
      ["responseCode", { payCodes: { responseCode: "100" } }],
      ["responseCode absent", { payCodes: { responseCode: undefined } }],
      ["detailedResponseCode", { payCodes: { detailedResponseCode: "500" } }],
      ["detailedResponseCode absent", { payCodes: { detailedResponseCode: undefined } }],
      ["responseMessage", { payCodes: { responseMessage: "OK" } }],
      ["responseMessage absent", { payCodes: { responseMessage: undefined } }],
      ["detailedResponseMessage", { payCodes: { detailedResponseMessage: "Success" } }],
      ["detailedResponseMessage absent", { payCodes: { detailedResponseMessage: undefined } }],
      ["no codes on the Pay transaction", { pay: { codes: undefined } }],
      ["Pay transaction status Failed", { pay: { status: "Failed" } }],
      ["Pay transaction amount differs", { pay: { amount: 0.5 } }],
      ["no Pay transaction at all", { pay: null }],
      ["only an Authentication transaction with paid codes", { pay: { type: "Authentication" } }],
      ["order status InProgress", { order: { status: "InProgress" } }],
      ["order status Authorized", { order: { status: "Authorized" } }],
      ["detailedStatus Authorized", { order: { detailedStatus: "Authorized" } }],
      ["detailedStatus Refunded", { order: { detailedStatus: "Refunded" } }],
      ["detailedStatus absent", { order: { detailedStatus: undefined } }],
      ["status lower-case", { order: { status: "success" } }],
      ["detailedStatus lower-case", { order: { detailedStatus: "paid" } }],
      ["payment operation PreAuthorize", { order: { paymentOperation: "PreAuthorize" } }],
    ];
    for (const [name, over] of notPaid) {
      const payload = decoded(over);
      assert.notEqual(classifyCallback(payload), "paid", name);
      assert.equal(isPaidCallback(payload), false, name);
    }
  });

  test("a successful Pay transaction among failed earlier ones still counts", () => {
    const payload = decoded({
      order: {
        transactions: [
          authenticationTx(),
          payTx({ transactionId: "11111111-1111-4111-8111-111111111111", status: "Failed" }, { responseCode: "100", responseMessage: "Failed", detailedResponseCode: "137", detailedResponseMessage: "Declined" }),
          payTx(),
        ],
      },
    });
    assert.equal(classifyCallback(payload), "paid");
  });

  test("a closed hosted page is a cancellation wherever Geidea says so", () => {
    const cancelled: Parameters<typeof raw>[0][] = [
      { order: { status: "Cancelled", detailedStatus: "Cancelled" }, pay: null },
      { order: { status: "Failed", detailedStatus: "Cancelled" }, pay: null },
      {
        order: { status: "Failed", detailedStatus: "Failed" },
        pay: { status: "Failed" },
        payCodes: { responseCode: "100", responseMessage: "Failed", detailedResponseCode: "600", detailedResponseMessage: "Transaction Cancelled By User" },
      },
      {
        order: { status: "Failed", detailedStatus: "Failed", transactions: [authenticationTx({ status: "Cancelled" })] },
      },
    ];
    for (const over of cancelled) {
      assert.equal(classifyCallback(decoded(over)), "cancelled", JSON.stringify(over));
    }
  });

  test("failures, expiries and undecided states are told apart", () => {
    const failed = { order: { status: "Failed", detailedStatus: "Declined" }, pay: { status: "Failed" }, payCodes: { responseCode: "100", responseMessage: "Failed", detailedResponseCode: "137", detailedResponseMessage: "Declined" } };
    assert.equal(classifyCallback(decoded(failed)), "failed");
    assert.equal(classifyCallback(decoded({ order: { status: "Failed", detailedStatus: undefined }, pay: null })), "failed");
    assert.equal(classifyCallback(decoded({ order: { status: "Declined", detailedStatus: undefined }, pay: null })), "failed");
    assert.equal(classifyCallback(decoded({ order: { status: "InProgress", detailedStatus: undefined }, pay: { status: "Failed" }, payCodes: { responseCode: "100" } })), "failed");
    assert.equal(classifyCallback(decoded({ order: { status: "Expired", detailedStatus: "Expired" }, pay: null })), "expired");
    assert.equal(classifyCallback(decoded({ order: { status: "InProgress", detailedStatus: undefined }, pay: null })), "indeterminate");
    // Contradictions decide nothing: the order claims success while the Pay codes do not.
    assert.equal(classifyCallback(decoded({ payCodes: { responseCode: "100" } })), "indeterminate");
    assert.equal(classifyCallback(decoded({ payCodes: { detailedResponseCode: "500" } })), "indeterminate");
    assert.equal(classifyCallback(decoded({ pay: { status: "Failed" } })), "indeterminate");
    assert.equal(classifyCallback(decoded({ order: { detailedStatus: "Authorized" } })), "indeterminate");
  });

  test("failure reasons are short categories, never messages", () => {
    assert.equal(failureReasonFor("cancelled"), "cancelled_by_user");
    assert.equal(failureReasonFor("expired"), "expired");
    assert.equal(failureReasonFor("failed"), "provider_failed");
  });

  test("the provider status summary is bounded and carries only the two statuses", () => {
    assert.equal(providerStatusSummary("Success", "Paid"), "Success/Paid");
    assert.equal(providerStatusSummary("Failed", null), "Failed");
    assert.equal(providerStatusSummary("S".repeat(64), "D".repeat(64)).length, 120);
  });

  test("isPaidStatus and codesArePaid are exact", () => {
    assert.equal(isPaidStatus("Success", "Paid"), true);
    assert.equal(isPaidStatus("Success", null), false);
    assert.equal(isPaidStatus("Paid", "Paid"), false);
    assert.equal(isPaidStatus("Success", "Refunded"), false);
    assert.equal(isPaidStatus("success", "Paid"), false);
    assert.equal(codesArePaid({ ...PAID_CODES }), true);
    assert.equal(codesArePaid({ ...PAID_CODES, responseCode: "0" }), false);
    assert.equal(codesArePaid({ ...PAID_CODES, detailedResponseMessage: "The operation was successful." }), false);
    assert.equal(codesArePaid(null), false);
  });
});

/* ------------------------------------------------------------------ */
/* The inquiry                                                         */
/* ------------------------------------------------------------------ */

describe("inquiryDisagreement: Geidea's own account must match on every point", () => {
  const order = (over: Record<string, unknown> = {}) => ({
    orderId: ORDER_ID,
    status: "Success",
    detailedStatus: "Paid",
    amount: 1,
    currency: "SAR",
    merchantReferenceId: REF,
    totalRefundedAmount: null,
    ...over,
  });
  const expected = { orderId: ORDER_ID, merchantReferenceId: REF, amount: "1.00", currency: "SAR" };

  test("agrees when everything matches", () => {
    assert.equal(inquiryDisagreement(order(), expected), null);
    assert.equal(inquiryDisagreement(order({ merchantReferenceId: null }), expected), null);
    assert.equal(inquiryDisagreement(order({ orderId: ORDER_ID.toUpperCase() }), expected), null);
    assert.equal(inquiryDisagreement(order({ amount: "1.0" }), expected), null);
  });

  test("names the first field that disagrees", () => {
    assert.equal(inquiryDisagreement(order({ orderId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" }), expected), "orderId");
    assert.equal(inquiryDisagreement(order({ merchantReferenceId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" }), expected), "merchantReferenceId");
    assert.equal(inquiryDisagreement(order({ amount: 2 }), expected), "amount");
    assert.equal(inquiryDisagreement(order({ amount: 0.99 }), expected), "amount");
    assert.equal(inquiryDisagreement(order({ currency: "EGP" }), expected), "currency");
    assert.equal(inquiryDisagreement(order({ status: "Failed" }), expected), "status");
    assert.equal(inquiryDisagreement(order({ detailedStatus: null }), expected), "status");
    assert.equal(inquiryDisagreement(order({ detailedStatus: "Refunded" }), expected), "status");
    assert.equal(inquiryDisagreement(order({ detailedStatus: "PartiallyRefunded" }), expected), "status");
    assert.equal(inquiryDisagreement(order({ detailedStatus: "Authorized" }), expected), "status");
  });
});

/* ------------------------------------------------------------------ */
/* Purity                                                              */
/* ------------------------------------------------------------------ */

describe("the module is pure", () => {
  test("no env, no logging, no network, no database, and only the signature helper as a runtime import", () => {
    const src = readFileSync(new URL("../lib/payments/geidea/callback.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!src.includes("process.env"));
    assert.ok(!src.includes("console."));
    assert.ok(!/\bfetch\s*\(/.test(src));
    assert.ok(!src.includes("@/lib/prisma"));
    const runtimeImports = [...src.matchAll(/^import (?!type )[^;]*from "([^"]+)";/gm)].map((m) => m[1]);
    assert.deepEqual(runtimeImports, ["@/lib/payments/geidea/signature"]);
  });
});
