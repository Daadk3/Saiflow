/**
 * Geidea Checkout v2 — the request signature and the callback signature.
 *
 * Geidea authenticates a create-session request with an HMAC over five of its
 * fields, and the documented recipe is exact:
 *
 *   data      = MerchantPublicKey + Amount + Currency + MerchantReferenceId + Timestamp
 *   amount    = formatted with exactly two decimals ("19.99", "1850.00")
 *   signature = Base64( HMAC-SHA256( key = MerchantApiPassword, data ) )
 *
 * No separators between the fields, no lower-casing, no trimming. The string
 * Geidea hashes on its side is whatever arrives in the request body, so the
 * caller MUST put the very same strings in the body that it passed here — in
 * particular the same `timestamp` and the same two-decimal `amount`.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *
 * Pure functions over explicit arguments, and nothing else. It never reads
 * `process.env`, never logs, never touches the network, and never sees a
 * product row. That is deliberate: the API password is the one secret in the
 * payment path, and the fewer modules that can reach it, the fewer places a
 * review has to trust. The password arrives as a separate argument rather than
 * as a field of the input object, so the input — the five signed fields — is
 * safe to inspect or assert on without ever carrying the secret next to it.
 *
 * Error messages name the field that failed and never echo its value, so a
 * thrown error can be logged without disclosing a key or a reference.
 *
 * VALIDATION IS STRICT ON PURPOSE. A payment signature computed over a
 * mis-formatted amount or a currency in the wrong case is not "slightly
 * wrong": Geidea rejects it, or worse, accepts it against a different
 * interpretation of the amount. Every input that would not round-trip exactly
 * is refused here, where the message is clear, instead of surfacing later as
 * an opaque gateway error.
 *
 * THE CALLBACK SIGNATURE IS DIFFERENT and lives in the second half of this
 * file. It hashes seven fields (public key, amount, currency, order id,
 * status, merchant reference, timestamp) with the same key and encoding, and
 * is checked with a constant-time comparison: see `verifyCallbackSignature`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Thrown for any input this module refuses. Never contains an input value. */
export class GeideaSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeideaSignatureError";
  }
}

/**
 * The five fields Geidea signs, in the shape the caller has them.
 *
 * `amount` may be a number or a decimal string (for example the `toString()`
 * of a Prisma Decimal); either is normalised to two decimals. Everything else
 * is used byte-for-byte.
 */
export interface CreateSessionSignatureInput {
  merchantPublicKey: string;
  amount: number | string;
  currency: string;
  merchantReferenceId: string;
  timestamp: string;
}

/**
 * A plain decimal: digits, optionally a point and one or two decimals. No sign,
 * no exponent, no thousands separator, no leading zeros beyond a lone "0",
 * and only ASCII digits — an Arabic-Indic "١٩٫٩٩" is refused, not converted.
 */
const AMOUNT_STRING = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

/** ISO 4217 alphabetic code, exactly as Geidea expects it ("SAR", "EGP"). */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * Above this, `Number.prototype.toFixed` may switch to exponent notation, and
 * no SaiFlow price is within a million-fold of it (Product.price is
 * DECIMAL(10,2)). Refused rather than formatted wrongly.
 */
const MAX_AMOUNT = 1e15;

/**
 * Binary floating point cannot hold most two-decimal values exactly:
 * `0.1 + 0.2` is 0.30000000000000004. That much noise is tolerated and
 * formats to "0.30". A genuine third decimal — 19.995 — differs from its
 * two-decimal rendering by 0.005, far above this, and is refused: silently
 * rounding money is exactly the bug this guard exists to prevent.
 */
const FLOAT_TOLERANCE = 1e-6;

function requireText(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GeideaSignatureError(`${name} must be a non-empty string`);
  }
  if (value.trim().length === 0) {
    throw new GeideaSignatureError(`${name} must not be blank`);
  }
  if (value !== value.trim()) {
    throw new GeideaSignatureError(
      `${name} must not have leading or trailing whitespace`
    );
  }
  return value;
}

/**
 * Format an amount exactly as Geidea's signature expects it: two decimals,
 * a dot, no grouping — PHP's `number_format($x, 2, '.', '')`, C#'s
 * `ToString("F2", InvariantCulture)`.
 *
 * Refuses anything that would not survive the trip exactly: non-positive,
 * non-finite, more than two decimals, or a string that is not a plain decimal.
 */
export function formatGeideaAmount(amount: number | string): string {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      throw new GeideaSignatureError("amount must be a finite number");
    }
    if (amount <= 0) {
      throw new GeideaSignatureError("amount must be greater than zero");
    }
    if (amount >= MAX_AMOUNT) {
      throw new GeideaSignatureError("amount is too large");
    }
    const fixed = amount.toFixed(2);
    if (Math.abs(Number(fixed) - amount) > FLOAT_TOLERANCE) {
      throw new GeideaSignatureError(
        "amount must not have more than 2 decimal places"
      );
    }
    return fixed;
  }

  if (typeof amount === "string") {
    if (!AMOUNT_STRING.test(amount)) {
      throw new GeideaSignatureError(
        "amount must be a plain decimal string with at most 2 decimal places"
      );
    }
    const [whole, fraction = ""] = amount.split(".");
    const formatted = `${whole}.${fraction.padEnd(2, "0")}`;
    if (Number(formatted) <= 0) {
      throw new GeideaSignatureError("amount must be greater than zero");
    }
    return formatted;
  }

  throw new GeideaSignatureError("amount must be a number or a decimal string");
}

/**
 * Geidea's documented timestamp shape, `Y/m/d H:i:s` in PHP terms:
 * "2024/09/18 15:31:34". Zero-padded, 24-hour, rendered in UTC.
 *
 * The timestamp is signed and echoed, so the only hard requirement is that the
 * body and the signature carry the identical string — which is why this takes
 * a Date and returns the string once, for the caller to use in both places.
 *
 * UTC is a choice, not a documented requirement: the docs do not state a
 * timezone, and Vercel functions run in UTC. If the first test session reports
 * a timestamp rejection, rendering in Asia/Riyadh is the one-line change.
 */
export function formatGeideaTimestamp(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new GeideaSignatureError("timestamp source must be a valid Date");
  }
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * The exact string that is hashed: the five fields concatenated in Geidea's
 * order with nothing between them. Exported so a test can assert the
 * concatenation itself, independently of the HMAC.
 */
export function buildCreateSessionSignatureData(
  input: CreateSessionSignatureInput
): string {
  if (input === null || typeof input !== "object") {
    throw new GeideaSignatureError("signature input must be an object");
  }

  const merchantPublicKey = requireText(
    "merchantPublicKey",
    input.merchantPublicKey
  );
  const amount = formatGeideaAmount(input.amount);
  const currency = requireText("currency", input.currency);
  if (!CURRENCY_CODE.test(currency)) {
    throw new GeideaSignatureError(
      "currency must be a 3-letter uppercase ISO 4217 code"
    );
  }
  // Geidea itself treats the reference as optional. SaiFlow never omits it —
  // it is how a callback is matched back to a purchase — so an empty one is
  // refused here rather than discovered later as an unmatchable callback.
  const merchantReferenceId = requireText(
    "merchantReferenceId",
    input.merchantReferenceId
  );
  const timestamp = requireText("timestamp", input.timestamp);

  return `${merchantPublicKey}${amount}${currency}${merchantReferenceId}${timestamp}`;
}

/** Base64( HMAC-SHA256( key, data ) ), both key and data as UTF-8. */
export function hmacSha256Base64(data: string, key: string): string {
  return createHmac("sha256", Buffer.from(key, "utf8"))
    .update(data, "utf8")
    .digest("base64");
}

/**
 * The signature for a create-session request.
 *
 * `apiPassword` is the Merchant API Password, supplied by the caller from
 * server-side configuration. It is a separate argument so the signed input
 * never carries the secret, and its value never appears in any error.
 */
export function signCreateSession(
  input: CreateSessionSignatureInput,
  apiPassword: string
): string {
  if (typeof apiPassword !== "string" || apiPassword.length === 0) {
    throw new GeideaSignatureError("apiPassword is missing");
  }
  return hmacSha256Base64(buildCreateSessionSignatureData(input), apiPassword);
}

/* ------------------------------------------------------------------ */
/* Callback signature                                                  */
/* ------------------------------------------------------------------ */

/**
 * The seven fields Geidea signs on a callback, in the order it hashes them:
 *
 *   MerchantPublicKey + OrderAmount + OrderCurrency + OrderId + Status
 *     + MerchantReferenceId + timeStamp
 *
 * Six come from the payload: `order.amount`, `order.currency`,
 * `order.orderId`, `order.status`, `order.merchantReferenceId` and the
 * top-level `timeStamp`. The public key does NOT. It is OUR configured key, so
 * a callback signed for some other merchant can never verify here, whatever
 * the payload claims about itself.
 *
 * The amount is normalised to two decimals exactly as for a request. That
 * mirrors the request recipe and Geidea's own plugins; it is the one
 * assumption in this recipe that the first captured test callback should
 * confirm.
 */
export interface CallbackSignatureInput {
  merchantPublicKey: string;
  amount: number | string;
  currency: string;
  orderId: string;
  status: string;
  merchantReferenceId: string;
  timeStamp: string;
}

/**
 * The outcome of a verification. Never an exception for anything the payload
 * did: a bad callback is an ordinary, expected event, answered with a reason
 * the handler can count. Exceptions are reserved for OUR side being
 * misconfigured — no password, no public key — because a handler must not
 * mistake that for a forged callback and carry on.
 */
export type CallbackVerification =
  | { ok: true }
  | {
      ok: false;
      reason: "malformed_signature" | "malformed_fields" | "signature_mismatch";
    };

/**
 * Base64 of exactly 32 bytes: the only shape an HMAC-SHA256 digest can take.
 * Anything else is refused before it reaches the comparison, which is what
 * lets `timingSafeEqual`, which throws on unequal lengths, be called
 * unconditionally on what remains.
 */
const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/** The exact string Geidea hashed for a callback. Exported for tests. */
export function buildCallbackSignatureData(
  input: CallbackSignatureInput
): string {
  if (input === null || typeof input !== "object") {
    throw new GeideaSignatureError("callback signature input must be an object");
  }

  const merchantPublicKey = requireText(
    "merchantPublicKey",
    input.merchantPublicKey
  );
  const amount = formatGeideaAmount(input.amount);
  const currency = requireText("currency", input.currency);
  if (!CURRENCY_CODE.test(currency)) {
    throw new GeideaSignatureError(
      "currency must be a 3-letter uppercase ISO 4217 code"
    );
  }
  const orderId = requireText("orderId", input.orderId);
  const status = requireText("status", input.status);
  const merchantReferenceId = requireText(
    "merchantReferenceId",
    input.merchantReferenceId
  );
  const timeStamp = requireText("timeStamp", input.timeStamp);

  return `${merchantPublicKey}${amount}${currency}${orderId}${status}${merchantReferenceId}${timeStamp}`;
}

/** What Geidea's signature over these fields must be. Used only to compare. */
export function signCallback(
  input: CallbackSignatureInput,
  apiPassword: string
): string {
  if (typeof apiPassword !== "string" || apiPassword.length === 0) {
    throw new GeideaSignatureError("apiPassword is missing");
  }
  return hmacSha256Base64(buildCallbackSignatureData(input), apiPassword);
}

/**
 * Constant-time equality of two Base64 HMAC-SHA256 signatures.
 *
 * Both must have the 32-byte shape; the decoded bytes are then compared with
 * `crypto.timingSafeEqual`, so how many leading bytes happen to agree does
 * not change how long the comparison takes. A plain `===` on the strings
 * would leak exactly that, one byte at a time, to anyone able to time the
 * callback endpoint. Never throws: a wrong shape is simply not equal.
 */
export function safeEqualSignatures(expected: string, provided: string): boolean {
  if (!SIGNATURE_BASE64.test(expected) || !SIGNATURE_BASE64.test(provided)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, "base64"),
    Buffer.from(provided, "base64")
  );
}

/**
 * Verify a callback's signature against our credentials.
 *
 * Order of checks, and why:
 *   1. Our configuration. A missing password or public key throws: that is a
 *      deployment fault, and a handler must fail closed on it rather than
 *      record "signature mismatch" and move on.
 *   2. The provided signature's shape. Not a string, or not 32 Base64 bytes:
 *      `malformed_signature`, before anything is hashed.
 *   3. The payload fields. Anything the recipe cannot format, such as an
 *      amount with three decimals, a lower-case currency or a missing
 *      reference: `malformed_fields`.
 *   4. The comparison itself, in constant time: `signature_mismatch`.
 *
 * The provided signature never appears in the result or in any error, so a
 * handler can log the outcome freely.
 */
export function verifyCallbackSignature(
  input: CallbackSignatureInput,
  providedSignature: unknown,
  apiPassword: string
): CallbackVerification {
  if (typeof apiPassword !== "string" || apiPassword.length === 0) {
    throw new GeideaSignatureError("apiPassword is missing");
  }
  if (input === null || typeof input !== "object") {
    return { ok: false, reason: "malformed_fields" };
  }
  // Our key, not the payload's. Missing means misconfigured, so it throws.
  requireText("merchantPublicKey", input.merchantPublicKey);

  if (
    typeof providedSignature !== "string" ||
    !SIGNATURE_BASE64.test(providedSignature)
  ) {
    return { ok: false, reason: "malformed_signature" };
  }

  let expected: string;
  try {
    expected = signCallback(input, apiPassword);
  } catch (error) {
    if (error instanceof GeideaSignatureError) {
      return { ok: false, reason: "malformed_fields" };
    }
    throw error;
  }

  return safeEqualSignatures(expected, providedSignature)
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}
