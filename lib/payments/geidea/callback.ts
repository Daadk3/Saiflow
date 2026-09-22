/**
 * Geidea Checkout v2 — the callback, decoded and judged.
 *
 * Pure functions between the raw JSON Geidea posts and the decision the
 * webhook route has to make. Nothing here reads the environment, touches the
 * database or the network, or logs. It exists so that the judgement, "is this
 * callback a paid order for what we meant to sell?", can be tested
 * exhaustively without a fake of anything.
 *
 * THE SHAPE IS THE ONE GEIDEA ACTUALLY SENDS, confirmed on a captured test
 * callback rather than taken from the documentation:
 *
 *   { order: { orderId, amount, currency, status, detailedStatus,
 *              merchantReferenceId, sessionId, isTest, paymentOperation,
 *              transactions: [ { type, status, amount, codes: { responseCode,
 *              responseMessage, detailedResponseCode,
 *              detailedResponseMessage } } ], ... },
 *     signature, timeStamp, sessionId }
 *
 * The response codes and messages live on each transaction, not at the top
 * level. A paid order carries an "Authentication" transaction for 3DS and a
 * "Pay" transaction that moved the money; the Pay transaction's codes are the
 * ones the documented success values refer to.
 *
 * CONFIRMED ON 21 SEPTEMBER 2026, OFFLINE, AGAINST A REAL TEST CALLBACK: the
 * signed status field is `order.status`, the amount is signed in its
 * canonical two-decimal form ("1.00"), and the verifier in signature.ts
 * matched the real signature unchanged. The same order was then confirmed
 * through the authenticated order inquiry. The captured callback, its
 * signature, the keys, the merchant id and the card data were recorded
 * nowhere in this repository.
 *
 * The route composes these in a fixed order: decode, verify the signature
 * (signature.ts), load the attempt, compare it with the callback, classify
 * the outcome, and for a paid outcome ask Geidea directly before fulfilling.
 *
 * MONEY IS COMPARED AS CANONICAL TWO-DECIMAL STRINGS, never as floats. Both
 * the callback's amount and the stored Decimal go through the same formatter
 * the signature uses; equal strings mean equal riyals, and anything the
 * formatter refuses is a mismatch, not a rounding.
 *
 * UNKNOWN FIELDS DO NOT SURVIVE DECODING. The typed payload is built field by
 * field from the names listed above; a callback's masked card number,
 * cardholder name, card token, 3DS authentication token, its own copy of the
 * merchant public key, its customer fields and everything else it carries are
 * never copied, never stored and never logged.
 */

import type { GeideaOrder } from "@/lib/payments/geidea/client";
import {
  GeideaSignatureError,
  formatGeideaAmount,
} from "@/lib/payments/geidea/signature";

/** Geidea callbacks are around ten kilobytes. Anything larger is not one. */
export const MAX_CALLBACK_BYTES = 64 * 1024;

export interface GeideaCallbackCodes {
  responseCode: string | null;
  responseMessage: string | null;
  detailedResponseCode: string | null;
  detailedResponseMessage: string | null;
}

export interface GeideaCallbackTransaction {
  /** "Authentication", "Pay", ... as Geidea names them. */
  type: string;
  status: string;
  /** As sent, when present. Canonicalised before use. */
  amount: number | string | null;
  codes: GeideaCallbackCodes | null;
}

export interface GeideaCallbackOrder {
  orderId: string;
  /** As sent, a JSON number or a decimal string. Canonicalised before use. */
  amount: number | string;
  currency: string;
  status: string;
  detailedStatus: string | null;
  merchantReferenceId: string;
  /** Geidea's session id for this order, when present. */
  sessionId: string | null;
  /** Geidea's own statement of which account this is. */
  isTest: boolean | null;
  paymentOperation: string | null;
  transactions: GeideaCallbackTransaction[];
}

export interface GeideaCallbackPayload {
  order: GeideaCallbackOrder;
  /** Shape-checked by the verifier; here only bounded. */
  signature: string;
  timeStamp: string;
  /** The top-level copy of the session id, when present. */
  sessionId: string | null;
}

export type CallbackDecode =
  | { ok: true; payload: GeideaCallbackPayload }
  | { ok: false; path: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const SHORT_CODE = /^[0-9A-Za-z_-]{1,8}$/;
const MAX_ID = 64;
const MAX_STATUS = 64;
const MAX_TYPE = 32;
const MAX_MESSAGE = 200;
const MAX_SIGNATURE = 128;
const MAX_TIMESTAMP = 64;
/** A real order carries two transactions; a retried one a few more. */
const MAX_TRANSACTIONS = 50;

/** Internal: unwinds decoding to a JSON path. Never carries a value. */
class Malformed extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`malformed at ${path}`);
    this.name = "Malformed";
    this.path = path;
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(obj: JsonObject, key: string, path: string): JsonObject {
  const value = obj[key];
  if (!isObject(value)) throw new Malformed(`${path}.${key}`);
  return value;
}

function textAt(obj: JsonObject, key: string, path: string, max: number): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Malformed(`${path}.${key}`);
  }
  return value;
}

function optionalTextAt(
  obj: JsonObject,
  key: string,
  path: string,
  max: number
): string | null {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    throw new Malformed(`${path}.${key}`);
  }
  return value;
}

function uuidAt(obj: JsonObject, key: string, path: string): string {
  const value = textAt(obj, key, path, MAX_ID);
  if (!UUID.test(value)) throw new Malformed(`${path}.${key}`);
  return value;
}

function optionalUuidAt(obj: JsonObject, key: string, path: string): string | null {
  const value = optionalTextAt(obj, key, path, MAX_ID);
  if (value !== null && !UUID.test(value)) throw new Malformed(`${path}.${key}`);
  return value;
}

function optionalBooleanAt(obj: JsonObject, key: string, path: string): boolean | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new Malformed(`${path}.${key}`);
  return value;
}

function optionalShortCodeAt(obj: JsonObject, key: string, path: string): string | null {
  const value = optionalTextAt(obj, key, path, 8);
  if (value !== null && !SHORT_CODE.test(value)) throw new Malformed(`${path}.${key}`);
  return value;
}

/** A required amount: a number or decimal string the money formatter accepts. */
function amountAt(obj: JsonObject, key: string, path: string): number | string {
  const value = obj[key];
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Malformed(`${path}.${key}`);
  }
  if (canonicalAmount(value) === null) throw new Malformed(`${path}.${key}`);
  return value;
}

function optionalAmountAt(obj: JsonObject, key: string, path: string): number | string | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  return amountAt(obj, key, path);
}

function decodeCodes(value: unknown, path: string): GeideaCallbackCodes | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new Malformed(path);
  return {
    responseCode: optionalShortCodeAt(value, "responseCode", path),
    responseMessage: optionalTextAt(value, "responseMessage", path, MAX_MESSAGE),
    detailedResponseCode: optionalShortCodeAt(value, "detailedResponseCode", path),
    detailedResponseMessage: optionalTextAt(value, "detailedResponseMessage", path, MAX_MESSAGE),
  };
}

/**
 * The transactions, each reduced to type, status, amount and codes. Absent
 * or null is an empty list: a callback for a hosted page the buyer closed
 * may carry no transaction at all.
 */
function decodeTransactions(value: unknown, path: string): GeideaCallbackTransaction[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TRANSACTIONS) throw new Malformed(path);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isObject(item)) throw new Malformed(itemPath);
    return {
      type: textAt(item, "type", itemPath, MAX_TYPE),
      status: textAt(item, "status", itemPath, MAX_STATUS),
      amount: optionalAmountAt(item, "amount", itemPath),
      codes: decodeCodes(item.codes, `${itemPath}.codes`),
    };
  });
}

/**
 * Decode a callback body into the shape above, or say where it stopped being
 * one. Every string is bounded, every id is a UUID, every amount is something
 * the money formatter accepts. The result contains only the fields named.
 */
export function decodeCallbackPayload(json: unknown): CallbackDecode {
  try {
    if (!isObject(json)) throw new Malformed("$");
    const order = objectAt(json, "order", "$");

    const decodedOrder: GeideaCallbackOrder = {
      orderId: uuidAt(order, "orderId", "$.order"),
      amount: amountAt(order, "amount", "$.order"),
      currency: textAt(order, "currency", "$.order", 3),
      status: textAt(order, "status", "$.order", MAX_STATUS),
      detailedStatus: optionalTextAt(order, "detailedStatus", "$.order", MAX_STATUS),
      merchantReferenceId: uuidAt(order, "merchantReferenceId", "$.order"),
      sessionId: optionalUuidAt(order, "sessionId", "$.order"),
      isTest: optionalBooleanAt(order, "isTest", "$.order"),
      paymentOperation: optionalTextAt(order, "paymentOperation", "$.order", MAX_TYPE),
      transactions: decodeTransactions(order.transactions, "$.order.transactions"),
    };
    if (!CURRENCY_CODE.test(decodedOrder.currency)) throw new Malformed("$.order.currency");

    return {
      ok: true,
      payload: {
        order: decodedOrder,
        signature: textAt(json, "signature", "$", MAX_SIGNATURE),
        timeStamp: textAt(json, "timeStamp", "$", MAX_TIMESTAMP),
        sessionId: optionalUuidAt(json, "sessionId", "$"),
      },
    };
  } catch (error) {
    if (error instanceof Malformed) return { ok: false, path: error.path };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/**
 * The canonical two-decimal rendering of an amount, or null if it has none.
 *
 * Accepts a number, a decimal string, or an object that renders itself as a
 * decimal string, which is what a Prisma Decimal is. Arrays are refused even
 * though `[19.99]` would stringify to "19.99": a list is not a price.
 */
export function canonicalAmount(value: unknown): string | null {
  let candidate: unknown = value;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    typeof (candidate as { toString?: unknown }).toString === "function" &&
    (candidate as object).toString !== Object.prototype.toString
  ) {
    candidate = String(candidate);
  }
  if (typeof candidate !== "number" && typeof candidate !== "string") return null;
  try {
    return formatGeideaAmount(candidate);
  } catch (error) {
    if (error instanceof GeideaSignatureError) return null;
    throw error;
  }
}

/** True only when both amounts canonicalise and the canonical strings are identical. */
export function amountsMatch(a: unknown, b: unknown): boolean {
  const x = canonicalAmount(a);
  const y = canonicalAmount(b);
  return x !== null && y !== null && x === y;
}

/* ------------------------------------------------------------------ */
/* Outcome                                                             */
/* ------------------------------------------------------------------ */

export type CallbackOutcome =
  | "paid"
  | "cancelled"
  | "expired"
  | "failed"
  | "indeterminate";

/** The documented success values, all four required at once. */
export const PAID_CODES: Readonly<Required<{ [K in keyof GeideaCallbackCodes]: string }>> = {
  responseCode: "000",
  responseMessage: "Success",
  detailedResponseCode: "000",
  detailedResponseMessage: "The operation was successful",
};

/** A paid order: status "Success" with detailed status "Paid", exactly. */
export function isPaidStatus(status: string, detailedStatus: string | null): boolean {
  return status === "Success" && detailedStatus === "Paid";
}

export function codesArePaid(codes: GeideaCallbackCodes | null): boolean {
  return (
    codes !== null &&
    codes.responseCode === PAID_CODES.responseCode &&
    codes.responseMessage === PAID_CODES.responseMessage &&
    codes.detailedResponseCode === PAID_CODES.detailedResponseCode &&
    codes.detailedResponseMessage === PAID_CODES.detailedResponseMessage
  );
}

export function payTransactions(order: GeideaCallbackOrder): GeideaCallbackTransaction[] {
  return order.transactions.filter((t) => t.type === "Pay");
}

/**
 * The Pay transaction that proves the money moved: status "Success", the four
 * documented codes, and, when it states an amount, the order's amount. Null
 * when no transaction qualifies.
 */
export function paidTransaction(order: GeideaCallbackOrder): GeideaCallbackTransaction | null {
  const orderAmount = canonicalAmount(order.amount);
  return (
    payTransactions(order).find(
      (t) =>
        t.status === "Success" &&
        codesArePaid(t.codes) &&
        (t.amount === null || canonicalAmount(t.amount) === orderAmount)
    ) ?? null
  );
}

/** The codes of the most recent Pay transaction, for logging. Null when none. */
export function latestPayCodes(order: GeideaCallbackOrder): GeideaCallbackCodes | null {
  const pays = payTransactions(order);
  return pays.length === 0 ? null : pays[pays.length - 1].codes;
}

/**
 * Paid means all of: order status "Success", detailed status "Paid", a
 * payment operation of "Pay" when stated, and a Pay transaction with status
 * "Success" and the four documented codes. Nothing weaker counts: not a
 * redirect, not a 200, not an order id, not a success status beside a
 * transaction whose codes say otherwise.
 */
export function isPaidCallback(p: GeideaCallbackPayload): boolean {
  return (
    isPaidStatus(p.order.status, p.order.detailedStatus) &&
    (p.order.paymentOperation === null || p.order.paymentOperation === "Pay") &&
    paidTransaction(p.order) !== null
  );
}

const FAILURE_WORDS = /^(failed|declined|rejected|error)$/i;

/**
 * What an authentic callback says happened. Precedence: paid, then a closed
 * hosted page (Geidea reports it as a cancellation by the user, in an order
 * status or in a transaction message), then expiry, then failure when the
 * order itself does not claim success, and otherwise indeterminate, which
 * covers "InProgress" and self-contradictory payloads. Indeterminate changes
 * nothing but is recorded.
 */
export function classifyCallback(p: GeideaCallbackPayload): CallbackOutcome {
  const { order } = p;
  if (isPaidCallback(p)) return "paid";

  const texts = [
    order.status,
    order.detailedStatus ?? "",
    ...order.transactions.flatMap((t) => [
      t.status,
      t.codes?.responseMessage ?? "",
      t.codes?.detailedResponseMessage ?? "",
    ]),
  ];
  if (texts.some((t) => /cancel/i.test(t))) return "cancelled";
  if (/^expired$/i.test(order.status) || /expir/i.test(order.detailedStatus ?? "")) {
    return "expired";
  }

  if (order.status !== "Success") {
    if (FAILURE_WORDS.test(order.status) || FAILURE_WORDS.test(order.detailedStatus ?? "")) {
      return "failed";
    }
    const pays = payTransactions(order);
    const latest = pays.length === 0 ? null : pays[pays.length - 1];
    if (
      latest !== null &&
      (FAILURE_WORDS.test(latest.status) ||
        (latest.codes?.responseCode !== null &&
          latest.codes?.responseCode !== undefined &&
          latest.codes.responseCode !== "000"))
    ) {
      return "failed";
    }
  }
  return "indeterminate";
}

export type FailureOutcome = "cancelled" | "expired" | "failed";

/** The short category stored on the attempt. Never a provider message. */
export function failureReasonFor(
  outcome: FailureOutcome
): "cancelled_by_user" | "expired" | "provider_failed" {
  if (outcome === "cancelled") return "cancelled_by_user";
  if (outcome === "expired") return "expired";
  return "provider_failed";
}

/** "Success/Paid", "Failed": the provider's own words, bounded, for support. */
export function providerStatusSummary(status: string, detailedStatus: string | null): string {
  return (detailedStatus === null ? status : `${status}/${detailedStatus}`).slice(0, 120);
}

/* ------------------------------------------------------------------ */
/* Defence in depth: the inquiry                                       */
/* ------------------------------------------------------------------ */

export interface ExpectedPaidOrder {
  orderId: string;
  merchantReferenceId: string;
  /** Canonical two-decimal string of the STORED amount. */
  amount: string;
  currency: string;
}

/**
 * Why Geidea's own account of the order disagrees with a paid callback, or
 * null when it agrees on every point. A refunded order is a disagreement:
 * "Refunded" is not "Paid", and a refunded purchase is not delivered.
 */
export function inquiryDisagreement(
  order: GeideaOrder,
  expected: ExpectedPaidOrder
): string | null {
  if (order.orderId.toLowerCase() !== expected.orderId.toLowerCase()) return "orderId";
  if (
    order.merchantReferenceId !== null &&
    order.merchantReferenceId !== expected.merchantReferenceId
  ) {
    return "merchantReferenceId";
  }
  if (canonicalAmount(order.amount) !== expected.amount) return "amount";
  if (order.currency !== expected.currency) return "currency";
  if (!isPaidStatus(order.status, order.detailedStatus)) return "status";
  return null;
}
