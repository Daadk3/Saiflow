/**
 * Identifiers for log lines, shortened so a log can never hand out a bearer.
 *
 * Two values in the payment path double as credentials: the merchant
 * reference, which opens a purchased file on the success channel, and the
 * Order id, which opens it on the receipt channel. Both belong in logs for
 * correlation and neither belongs there in full. Eight characters of a UUID
 * or a cuid identify a row for support without reconstructing the bearer;
 * anything shorter is halved, so a test fixture like "order_1" cannot slip
 * through whole either.
 */
export function redactId(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) return "";
  const keep = value.length > 8 ? 8 : Math.ceil(value.length / 2);
  return `${value.slice(0, keep)}…`;
}
