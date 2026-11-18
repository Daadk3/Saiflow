/**
 * The buyer's name, collected on the checkout page so the founder can see
 * who bought.
 *
 * Client-safe and pure: the checkout page checks the name with this before
 * asking for a payment session, and the checkout route checks it again,
 * with the same rule, before recording the attempt.
 *
 * NEVER AN AUTHORITY. The name decides nothing about money, the product,
 * the attempt or the right to a file. Proof of purchase stays the Order
 * row written by the verified callback. A wrong name costs nobody a
 * purchase; it only mislabels the founder's record of it.
 *
 * Stored trimmed, with the buyer's own capitals kept. Letters from any
 * language count, so an Arabic name and an English one follow one rule.
 */

/** Long enough for a full Arabic or English name, short enough to display. */
export const MAX_BUYER_NAME_LENGTH = 80;

const CONTROL = /[\u0000-\u001f\u007f]/;
const LETTER = /\p{L}/u;
/** Letters, marks, numbers, and the punctuation a person's name uses. */
const SHAPE = /^[\p{L}\p{M}\p{N} .'\u2019,-]+$/u;

/** The name as stored, or null when it is not one SaiFlow will keep. */
export function normalizeBuyerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (CONTROL.test(value)) return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > MAX_BUYER_NAME_LENGTH) return null;
  if (!LETTER.test(name)) return null;
  if (!SHAPE.test(name)) return null;
  return name;
}
