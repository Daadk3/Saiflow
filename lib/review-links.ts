/**
 * Signed links that let a guest buyer review a product they paid for.
 *
 * Checkout has no signed-in buyer. The receipt, the success page and "My
 * purchases" are how a buyer comes back, and the first two cannot rely on a
 * session. A review link is the same shape as a receipt download link
 * (lib/download-links): order id, expiry and an HMAC, keyed from
 * NEXTAUTH_SECRET with a purpose of its own so a download token cannot be
 * replayed here and a review token cannot download a file.
 *
 * The signature also covers the product and the normalised buyer email, which
 * are not written into the token. The email stays out of URLs and logs. A
 * token copied onto another product, another order or another address fails
 * closed. It proves only that SaiFlow issued a link for that purchase and
 * that the link is still in date. The review route loads the Order again and
 * refuses anything that is not a verified paid purchase.
 *
 * After it expires, a buyer who signs in with the address they bought with
 * reviews from "My purchases". That channel is a session, not a link.
 *
 * Pure: no database, no request, no logging. The secret is passed in.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeBuyerEmail } from "@/lib/checkout/buyer-email";

/** How long a review link in a receipt or on the success page works. */
export const REVIEW_LINK_TTL_DAYS = 30;
const REVIEW_LINK_TTL_MS = REVIEW_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Domain separation: this key signs review links and nothing else. */
const PURPOSE = "saiflow:product-review:v1";

/** Cuid-shaped ids. "." can never appear, so the token splits cleanly. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

function keyFor(secret: string): Buffer {
  return createHmac("sha256", secret).update(PURPOSE).digest();
}

function sign(secret: string, orderId: string, productId: string, email: string, expiresAtSeconds: number): string {
  return createHmac("sha256", keyFor(secret))
    .update(`${orderId}.${productId}.${email}.${expiresAtSeconds}`)
    .digest("base64url");
}

export function reviewLinkExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + REVIEW_LINK_TTL_MS);
}

export type ReviewTokenCheck =
  | { ok: true; orderId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "no_secret" };

/** The order id a token names, before the signature is checked. Null when the token is not even shaped like one. */
export function readReviewToken(token: string): { orderId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [orderId, expText, signature] = parts;
  if (!ID.test(orderId) || !/^\d{1,12}$/.test(expText) || !SIGNATURE.test(signature)) return null;
  return { orderId };
}

/**
 * A token for one paid order, valid until `expiresAt`. Throws without a
 * secret or a usable email: an unsigned link must never be sent.
 */
export function signReviewToken(
  input: { orderId: string; productId: string; customerEmail: string; expiresAt: Date },
  secret: string | undefined
): string {
  if (!secret) throw new Error("review link secret missing");
  const email = normalizeBuyerEmail(input.customerEmail);
  if (!email) throw new Error("review link email malformed");
  if (!ID.test(input.orderId) || !ID.test(input.productId)) throw new Error("review link id malformed");
  const exp = Math.floor(input.expiresAt.getTime() / 1000);
  return `${input.orderId}.${exp}.${sign(secret, input.orderId, input.productId, email, exp)}`;
}

/**
 * Whether `token` is a link SaiFlow issued for this product and this buyer
 * email, and is still in date. The signature is checked before the expiry,
 * so an expired verdict is only ever given for a genuine link.
 */
export function verifyReviewToken(
  token: string,
  productId: string,
  customerEmail: string,
  secret: string | undefined,
  now: Date = new Date()
): ReviewTokenCheck {
  if (!secret) return { ok: false, reason: "no_secret" };
  const parsed = readReviewToken(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  const email = normalizeBuyerEmail(customerEmail);
  if (!email || !ID.test(productId)) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  const exp = Number(parts[1]);
  const signature = parts[2];
  const expected = Buffer.from(sign(secret, parsed.orderId, productId, email, exp));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  if (now.getTime() > exp * 1000) return { ok: false, reason: "expired" };
  return { ok: true, orderId: parsed.orderId };
}

/** Relative path for the success page, which only accepts a same-origin path. */
export function reviewPagePath(
  input: { orderId: string; productId: string; customerEmail: string; issuedAt?: Date },
  secret: string | undefined
): string {
  const token = signReviewToken(
    {
      orderId: input.orderId,
      productId: input.productId,
      customerEmail: input.customerEmail,
      expiresAt: reviewLinkExpiry(input.issuedAt ?? new Date()),
    },
    secret
  );
  return `/review/${encodeURIComponent(input.productId)}?t=${encodeURIComponent(token)}`;
}

/** Absolute link for the receipt email. */
export function reviewPageUrl(
  base: string,
  input: { orderId: string; productId: string; customerEmail: string; issuedAt?: Date },
  secret: string | undefined
): string {
  return `${base}${reviewPagePath(input, secret)}`;
}
