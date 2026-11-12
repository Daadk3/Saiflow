/**
 * Who may review a product.
 *
 * An Order row is written only after a payment provider has proved the money
 * moved. Failed, cancelled and expired attempts never become an Order, so
 * "no order" is the ordinary way an unpaid buyer is refused.
 *
 * This still refuses an Order whose linked payment session is anything but
 * PAID, and one whose provider status says the payment was refunded. That is
 * defence in depth for a row that should not exist, and for the refund case
 * lib/payouts already records as a known gap: Order has no refund column, so
 * the only refund signal stored today is PaymentSession.providerStatus. A
 * legacy Stripe order has no payment session; the Order itself is the proof,
 * and those rows stay reviewable.
 *
 * The buyer is the normalised customerEmail. Guest checkout has no user id.
 */

export type PaymentSessionForReview = {
  status: string;
  providerStatus: string | null;
};

export type OrderForReview = {
  productId: string;
  customerEmail: string;
  paymentSession: PaymentSessionForReview | null;
};

export type ReviewRefusal = "no_order" | "unpaid" | "refunded" | "product_mismatch" | "email_mismatch";

const REFUND = /refund/i;

export function reviewRefusal(
  order: OrderForReview | null,
  expected: { productId: string; customerEmail: string }
): ReviewRefusal | null {
  if (!order) return "no_order";
  if (order.productId !== expected.productId) return "product_mismatch";
  if (order.customerEmail.trim().toLowerCase() !== expected.customerEmail.trim().toLowerCase()) {
    return "email_mismatch";
  }
  const session = order.paymentSession;
  if (session && REFUND.test(session.providerStatus ?? "")) return "refunded";
  if (session && session.status !== "PAID") return "unpaid";
  return null;
}
