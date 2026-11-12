/**
 * How a review is shown. The buyer is one letter of their address and nothing
 * else: never the local part, never the domain. Hidden reviews are not part
 * of the average.
 */

export const PUBLIC_REVIEW_LIMIT = 20;

/** One character of the address, then a mask. An address with no letter still shows a mask. */
export function maskedBuyer(email: string): string {
  const local = email.split("@")[0] ?? "";
  const first = Array.from(local).find((ch) => /[\p{L}\p{N}]/u.test(ch));
  return `${first ?? "•"}•••`;
}

export function roundReviewAverage(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Average of the rows the caller already decided are visible. Null when there are none: no default stars. */
export function summarizeVisible(stars: number[]): { average: number; count: number } | null {
  if (stars.length === 0) return null;
  const sum = stars.reduce((total, score) => total + score, 0);
  return { average: roundReviewAverage(sum / stars.length), count: stars.length };
}

export function visibleStars<T extends { stars: number; hiddenAt: Date | null }>(rows: T[]): number[] {
  return rows.filter((row) => row.hiddenAt === null).map((row) => row.stars);
}
