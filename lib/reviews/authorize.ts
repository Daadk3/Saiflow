/**
 * The purchase check behind a review.
 *
 * Two ways in, and no third. A signed review token (receipt, success page)
 * names an order; the signature must match that order's product and email,
 * and the order must still be a verified paid purchase. A signed-in buyer
 * may use the order id from "My purchases" when their session email is the
 * email on that order. A token that does not verify, and an order that is
 * not there, answer the same way: the caller cannot tell whether the order
 * exists. An expired verdict is only returned for a signature that matched.
 */

import { prisma } from "@/lib/prisma";
import { normalizeBuyerEmail } from "@/lib/checkout/buyer-email";
import { readReviewToken, verifyReviewToken } from "@/lib/review-links";
import { reviewRefusal } from "@/lib/reviews/eligibility";

const ORDER_SELECT = {
  id: true,
  productId: true,
  productName: true,
  customerEmail: true,
  paymentSession: { select: { status: true, providerStatus: true } },
} as const;

export type ReviewAuth =
  | { ok: true; orderId: string; productId: string; productName: string; email: string }
  | { ok: false; error: "invalid" | "expired" | "not_allowed" | "unauthorized"; status: 401 | 403 };

export async function authorizeReviewWrite(input: {
  productId: string;
  token?: string;
  orderId?: string;
  sessionEmail: string | null;
  secret: string | undefined;
  now?: Date;
}): Promise<ReviewAuth> {
  if (input.token) return authorizeToken(input.token, input.productId, input.secret, input.now);
  if (input.orderId) return authorizeSession(input.orderId, input.productId, input.sessionEmail);
  return { ok: false, error: "invalid", status: 403 };
}

async function authorizeToken(
  token: string,
  productId: string,
  secret: string | undefined,
  now?: Date
): Promise<ReviewAuth> {
  const parsed = readReviewToken(token);
  if (!parsed) return { ok: false, error: "invalid", status: 403 };
  const order = await prisma.order.findUnique({ where: { id: parsed.orderId }, select: ORDER_SELECT });
  if (!order) return { ok: false, error: "invalid", status: 403 };
  const email = normalizeBuyerEmail(order.customerEmail);
  if (!email) return { ok: false, error: "invalid", status: 403 };
  const check = verifyReviewToken(token, productId, email, secret, now);
  if (!check.ok) {
    return { ok: false, error: check.reason === "expired" ? "expired" : "invalid", status: 403 };
  }
  const refusal = reviewRefusal(
    { productId: order.productId, customerEmail: email, paymentSession: order.paymentSession },
    { productId, customerEmail: email }
  );
  if (refusal === "unpaid" || refusal === "refunded") return { ok: false, error: "not_allowed", status: 403 };
  if (refusal) return { ok: false, error: "invalid", status: 403 };
  return { ok: true, orderId: order.id, productId: order.productId, productName: order.productName, email };
}

async function authorizeSession(orderId: string, productId: string, sessionEmail: string | null): Promise<ReviewAuth> {
  const email = normalizeBuyerEmail(sessionEmail);
  if (!email) return { ok: false, error: "unauthorized", status: 401 };
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order) return { ok: false, error: "not_allowed", status: 403 };
  const stored = normalizeBuyerEmail(order.customerEmail);
  if (!stored) return { ok: false, error: "not_allowed", status: 403 };
  const refusal = reviewRefusal(
    { productId: order.productId, customerEmail: stored, paymentSession: order.paymentSession },
    { productId, customerEmail: email }
  );
  if (refusal) return { ok: false, error: "not_allowed", status: 403 };
  return { ok: true, orderId: order.id, productId: order.productId, productName: order.productName, email };
}

export type ReviewDraft =
  | {
      ok: true;
      productName: string;
      stars: number | null;
      body: string | null;
      hidden: boolean;
      token?: string;
      orderId?: string;
    }
  | { ok: false; error: "invalid" | "expired" | "not_allowed" | "unauthorized" };

/** What the review form shows: the purchase check, then the buyer's own review if they already wrote one. */
export async function prepareReviewForm(input: {
  productId: string;
  token?: string;
  orderId?: string;
  sessionEmail: string | null;
  secret: string | undefined;
}): Promise<ReviewDraft> {
  const auth = await authorizeReviewWrite(input);
  if (!auth.ok) return { ok: false, error: auth.error };
  const existing = await prisma.productReview.findUnique({
    where: { buyerEmail_productId: { buyerEmail: auth.email, productId: auth.productId } },
    select: { stars: true, body: true, hiddenAt: true },
  });
  return {
    ok: true,
    productName: auth.productName,
    stars: existing?.stars ?? null,
    body: existing?.body ?? null,
    hidden: existing?.hiddenAt != null,
    ...(input.token ? { token: input.token } : { orderId: input.orderId }),
  };
}
