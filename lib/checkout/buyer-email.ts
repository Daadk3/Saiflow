/**
 * The buyer's email, for the purchase receipt and nothing else.
 *
 * Client-safe and pure: the checkout page checks the address with this
 * before asking for a payment session, and the checkout route checks it
 * again, with the same rule, before recording the attempt.
 *
 * NEVER AN AUTHORITY. The email decides nothing about money, the product,
 * the attempt or the right to a file. Proof of purchase stays the Order row
 * written by the verified callback; the email is only where its receipt,
 * and with it the download link, is sent. A wrong address costs the buyer
 * their receipt, never anyone else their purchase.
 *
 * Deliberately simple: one "@", a dotted domain, no whitespace, no control
 * characters and none of the characters that would let an address carry
 * markup or extra headers. Stored trimmed and lower-cased so a returning
 * buyer is not two different people.
 */

/** RFC 5321's limit on a forward path. */
export const MAX_BUYER_EMAIL_LENGTH = 254;

const FORBIDDEN = /[\s<>"'`,;:\\()[\]\u0000-\u001f\u007f]/;
const SHAPE = /^[^@]+@[^@.]+(\.[^@.]+)+$/;

/** The address as stored, or null when it is not one SaiFlow will send a receipt to. */
export function normalizeBuyerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_BUYER_EMAIL_LENGTH) return null;
  if (FORBIDDEN.test(email)) return null;
  if (!SHAPE.test(email)) return null;
  const tld = email.slice(email.lastIndexOf(".") + 1);
  if (tld.length < 2) return null;
  return email;
}
