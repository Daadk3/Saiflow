/**
 * Receipt download links that expire.
 *
 * A receipt used to link to `/api/download/<product>?orderId=<order>`: a
 * bearer that never expired, so a forwarded or leaked receipt opened the file
 * forever, for anyone, with no sign-in. A receipt now carries a signed token
 * instead: the order, the product it is for, and an expiry, under an HMAC
 * keyed from the server's NEXTAUTH_SECRET with a purpose label of its own, so
 * the key opens nothing else and a token is useless without the server.
 *
 * After it expires the buyer signs in with the address they bought with and
 * downloads from "My purchases" (the download route's account channel), which
 * never expires because it is a sign-in, not a link.
 *
 * The token proves only "SaiFlow issued a link for this order and product,
 * and it is still in date". The download route still requires the Order row
 * and still runs the safety gate on every request; a token never delivers by
 * itself.
 *
 * Pure: no database, no request, no logging. The secret is passed in.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a receipt's download link works. */
export const RECEIPT_LINK_TTL_DAYS = 7;
const RECEIPT_LINK_TTL_MS = RECEIPT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Domain separation: this key signs receipt links and nothing else. */
const PURPOSE = "saiflow:receipt-download:v1";

/** Order ids are cuids; whatever they are, "." can never appear inside one, so the token splits cleanly. */
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

function keyFor(secret: string): Buffer {
  return createHmac("sha256", secret).update(PURPOSE).digest();
}

function sign(secret: string, orderId: string, productId: string, expiresAtSeconds: number): string {
  return createHmac("sha256", keyFor(secret)).update(`${orderId}.${productId}.${expiresAtSeconds}`).digest("base64url");
}

/** The moment a link issued at `issuedAt` stops working. */
export function receiptLinkExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + RECEIPT_LINK_TTL_MS);
}

/** Whether a link-free channel bound to an order made at `orderCreatedAt` is still in date at `now`. */
export function withinReceiptWindow(orderCreatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() <= receiptLinkExpiry(orderCreatedAt).getTime();
}

/** A token for one order's file, valid until `expiresAt`. Throws without a secret: an unsigned link must never be sent. */
export function signReceiptToken(
  input: { orderId: string; productId: string; expiresAt: Date },
  secret: string | undefined
): string {
  if (!secret) throw new Error("receipt link secret missing");
  if (!ORDER_ID.test(input.orderId)) throw new Error("receipt link order id malformed");
  const exp = Math.floor(input.expiresAt.getTime() / 1000);
  return `${input.orderId}.${exp}.${sign(secret, input.orderId, input.productId, exp)}`;
}

export type ReceiptTokenCheck =
  | { ok: true; orderId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "no_secret" };

/**
 * Whether `token` is a link SaiFlow issued for `productId` and is still in
 * date. The signature is checked before the expiry, so an expired verdict is
 * only ever given for a genuine link, and a forged one can never learn that
 * its order exists.
 */
export function verifyReceiptToken(
  token: string,
  productId: string,
  secret: string | undefined,
  now: Date = new Date()
): ReceiptTokenCheck {
  if (!secret) return { ok: false, reason: "no_secret" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [orderId, expText, signature] = parts;
  if (!ORDER_ID.test(orderId) || !/^\d{1,12}$/.test(expText) || !SIGNATURE.test(signature)) {
    return { ok: false, reason: "malformed" };
  }
  const exp = Number(expText);
  const expected = Buffer.from(sign(secret, orderId, productId, exp));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  if (now.getTime() > exp * 1000) return { ok: false, reason: "expired" };
  return { ok: true, orderId };
}

/** The receipt's link: absolute, signed, and in date for RECEIPT_LINK_TTL_DAYS from `issuedAt`. */
export function receiptDownloadUrl(
  base: string,
  input: { orderId: string; productId: string; issuedAt?: Date },
  secret: string | undefined
): string {
  const token = signReceiptToken(
    { orderId: input.orderId, productId: input.productId, expiresAt: receiptLinkExpiry(input.issuedAt ?? new Date()) },
    secret
  );
  return `${base}/api/download/${encodeURIComponent(input.productId)}?t=${encodeURIComponent(token)}`;
}
