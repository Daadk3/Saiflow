/**
 * What the buyer may be told about a payment attempt, and how it is decided.
 *
 * The browser-facing status endpoint answers one question per merchant
 * reference: is the purchase confirmed, still in flight, or over? The answer
 * is derived from SaiFlow's own rows and nothing else. Geidea is never asked
 * on the buyer's behalf, and the buyer's arrival on the success page is not a
 * fact about money.
 *
 * "paid" is reported on exactly one condition: an Order row exists for the
 * reference. The callback route writes that row and the attempt's PAID status
 * in one transaction after verifying the signature, the amount, the currency,
 * the environment and Geidea's own account of the order. An attempt that says
 * PAID without an Order is therefore not paid as far as the buyer is told; it
 * is still processing, because the only way that state can be observed is
 * mid-transaction or after a failure that support must look at.
 *
 * "expired" comes from the attempt's status when a callback closed it, and
 * otherwise from the clock: an attempt still open well past Geidea's own
 * expiry is reported expired so a stale link says something truthful. That
 * is a description, not a decision. A late but authentic callback still
 * fulfils, and this module writes nothing.
 */

export type PaymentStatus = "processing" | "paid" | "failed" | "cancelled" | "expired";

/** The exact statuses the browser may receive. Nothing else is ever sent. */
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "processing",
  "paid",
  "failed",
  "cancelled",
  "expired",
];

/** A SaiFlow merchant reference: the UUID checkout generated for the attempt. */
export const MERCHANT_REFERENCE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMerchantReference(value: unknown): value is string {
  return typeof value === "string" && MERCHANT_REFERENCE.test(value);
}

/**
 * How long past Geidea's own expiry an open attempt is still called
 * processing. Callbacks for a payment made in the last seconds of a session
 * can arrive after the expiry, so the clock alone is not trusted at the edge.
 */
export const EXPIRY_GRACE_MS = 30 * 60 * 1000;

export interface AttemptView {
  status: string;
  expiresAt: Date | null;
}

export function statusFor(attempt: AttemptView, orderExists: boolean, now: Date): PaymentStatus {
  if (orderExists) return "paid";
  switch (attempt.status) {
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    case "CREATED":
    case "SESSION_CREATED":
      if (
        attempt.expiresAt !== null &&
        now.getTime() - attempt.expiresAt.getTime() > EXPIRY_GRACE_MS
      ) {
        return "expired";
      }
      return "processing";
    default:
      // PAID with no Order, or a status this module does not know: never
      // "paid" on the attempt's word alone.
      return "processing";
  }
}
