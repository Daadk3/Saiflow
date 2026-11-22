/**
 * SAR → USD at one fixed rate, in integers only.
 *
 * PayPal cannot charge SAR. The product's SAR price (canonical two-decimal
 * string, e.g. "49.00") is converted at PAYPAL_SAR_PER_USD (e.g. "3.75")
 * and rounded half-up to the cent. No floating point: halalas and a rate
 * scaled by 10^4 are integers, so the same inputs always give the same
 * cents on the server, in tests and on the page.
 *
 *   49.00 SAR at 3.75 → 4900 × 10000 / 37500 = 1306.67 → 13.07 USD
 */

const AMOUNT = /^(\d{1,8})\.(\d{2})$/;
const RATE = /^(\d{1,4})(?:\.(\d{1,4}))?$/;

/**
 * Integers throughout. The largest product is at most 10^8 SAR, so
 * halalas × 10^4 stays below 10^15, inside Number's exact-integer range.
 */
function toScaledInt(whole: string, fraction: string | undefined, places: number): number {
  return Number(whole) * 10 ** places + Number((fraction ?? "").padEnd(places, "0") || "0");
}

/** USD as a canonical two-decimal string, or null for an unusable amount or rate. */
export function sarToUsd(canonicalSar: string, sarPerUsd: string): string | null {
  const a = AMOUNT.exec(canonicalSar);
  const r = RATE.exec(sarPerUsd);
  if (!a || !r) return null;
  const halalas = toScaledInt(a[1], a[2], 2);
  const rateE4 = toScaledInt(r[1], r[2], 4);
  if (halalas <= 0 || rateE4 <= 0) return null;
  // cents = halalas × 10^4 / rateE4, rounded half-up.
  const numerator = halalas * 10000;
  let cents = Math.floor(numerator / rateE4);
  if ((numerator - cents * rateE4) * 2 >= rateE4) cents += 1;
  if (cents <= 0 || !Number.isSafeInteger(cents)) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
