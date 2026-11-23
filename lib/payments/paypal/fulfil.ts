/**
 * The one place a PayPal payment becomes an Order.
 *
 * Both the capture route (the buyer's browser, right after approval) and the
 * webhook route (PayPal, PAYMENT.CAPTURE.COMPLETED) end here, with PayPal's
 * own account of the order. Whichever arrives first fulfils; the other finds
 * the attempt already PAID and answers "already_fulfilled". Two arriving at
 * the same moment are settled by the database, exactly as for Geidea:
 *
 *   1. a conditional update claims the attempt (status not PAID, and the
 *      provider order id is this one), so only one caller sees count 1;
 *   2. the Order's unique merchant reference and unique
 *      (paymentProvider, providerOrderId) refuse a second insert even if a
 *      second claim somehow succeeded, which is reported as already
 *      fulfilled.
 *
 * The Order is built from the attempt, never from PayPal: the SAR price, the
 * SAR currency, the stored product, the stored buyer. PayPal contributes
 * only its order id, which the attempt already recorded. The receipt and
 * the seller/founder notice go out once, only from the caller that created
 * the Order.
 *
 * Geidea's flow (app/api/webhooks/geidea) is not used or changed here.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { sendPurchaseEmail } from "@/lib/email";
import { runAfterResponse } from "@/lib/after-response";
import { notifySaleFulfilled } from "@/lib/notify";
import { fromHalalas, saleBreakdown } from "@/lib/pricing";
import { redactId } from "@/lib/redact-id";
import { receiptAccessUrl, receiptDownloadUrl } from "@/lib/download-links";
import { reviewPageUrl } from "@/lib/review-links";
import { canonicalAmount } from "@/lib/payments/geidea/callback";
import { captureVerdict, type PayPalOrderView } from "@/lib/payments/paypal/verify";

export const PAYPAL_SESSION_SELECT = {
  id: true,
  merchantReferenceId: true,
  provider: true,
  environment: true,
  amount: true,
  currency: true,
  chargeAmount: true,
  chargeCurrency: true,
  status: true,
  productId: true,
  providerOrderId: true,
  buyerEmail: true,
  buyerName: true,
  founderTest: true,
} as const;

export interface PayPalSession {
  id: string;
  merchantReferenceId: string;
  provider: string;
  environment: "TEST" | "PRODUCTION";
  amount: Prisma.Decimal;
  currency: string;
  chargeAmount: Prisma.Decimal | null;
  chargeCurrency: string | null;
  status: string;
  productId: string;
  providerOrderId: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  founderTest: boolean;
}

export type SettleResult =
  | { kind: "fulfilled"; orderId: string }
  | { kind: "already_fulfilled" }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "mismatch"; reason: string }
  | { kind: "blocked"; reason: string };

type LogFields = Record<string, string | number | null | undefined>;

export function payPalLog(scope: string, level: "log" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const text = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console[level](`[PayPal ${scope}] ${event}${text.length > 0 ? ` ${text}` : ""}`);
}

/** The attempt's own record of what PayPal should have charged, or why it cannot be checked. */
export function expectedFor(session: PayPalSession): { orderId: string; amountUsd: string } | { problem: string } {
  if (session.provider !== "PAYPAL") return { problem: "provider" };
  if (session.providerOrderId === null) return { problem: "no_order_id" };
  if (session.chargeCurrency !== "USD") return { problem: "charge_currency" };
  const usd = canonicalAmount(session.chargeAmount);
  if (usd === null) return { problem: "charge_amount" };
  return { orderId: session.providerOrderId, amountUsd: usd };
}

class FulfilmentBlocked extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`fulfilment blocked: ${reason}`);
    this.name = "FulfilmentBlocked";
    this.reason = reason;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Settle one attempt from PayPal's own account of its order. The caller has
 * already authenticated the source (an authenticated API response, or a
 * webhook PayPal itself verified) and loaded the attempt by PayPal order id.
 */
export async function settlePayPalOrder(
  session: PayPalSession,
  view: PayPalOrderView,
  scope: "capture" | "webhook"
): Promise<SettleResult> {
  const ids = { session: session.id, ref: redactId(session.merchantReferenceId), paypalOrder: view.id };
  const expected = expectedFor(session);
  if ("problem" in expected) {
    payPalLog(scope, "error", "rejected", { reason: `attempt:${expected.problem}`, ...ids });
    return { kind: "mismatch", reason: expected.problem };
  }
  const verdict = captureVerdict(view, {
    orderId: expected.orderId,
    merchantReferenceId: session.merchantReferenceId,
    amountUsd: expected.amountUsd,
    currency: "USD",
  });
  const providerStatus = view.status.slice(0, 32);
  const receivedAt = new Date();

  if (verdict.kind === "mismatch") {
    // Authentic, but not what we meant to sell: left untouched for investigation.
    payPalLog(scope, "warn", "rejected", { reason: `mismatch:${verdict.reason}`, ...ids });
    return { kind: "mismatch", reason: verdict.reason };
  }
  if (verdict.kind === "pending") {
    await prisma.paymentSession.updateMany({
      where: { id: session.id, status: { not: "PAID" } },
      data: { providerStatus, callbackReceivedAt: receivedAt },
    });
    payPalLog(scope, "log", "pending", { reason: verdict.reason, ...ids });
    return { kind: "pending" };
  }
  if (verdict.kind === "failed") {
    // A paid attempt is never downgraded by a late failure.
    await prisma.paymentSession.updateMany({
      where: { id: session.id, status: { not: "PAID" } },
      data: { status: "FAILED", providerStatus, failureReason: "provider_declined", callbackReceivedAt: receivedAt },
    });
    payPalLog(scope, "log", "failed", { reason: verdict.reason, ...ids });
    return { kind: "failed" };
  }

  const result = await fulfil(session, expected.orderId, providerStatus, receivedAt);
  if (result.kind === "blocked") {
    payPalLog(scope, "error", "fulfilment_blocked", { reason: result.reason, ...ids });
    return result;
  }
  if (result.kind === "already_fulfilled") {
    payPalLog(scope, "log", "duplicate", ids);
    return result;
  }
  payPalLog(scope, "log", "fulfilled", { order: redactId(result.orderId), ...ids });
  await sendReceipt(session, result.orderId, result.productName, result.hosted);
  await runAfterResponse(() =>
    notifySaleFulfilled({
      orderId: result.orderId,
      productId: session.productId,
      productName: result.productName,
      amount: session.amount,
      currency: session.currency,
      environment: session.environment,
      founderTest: session.founderTest,
      buyerName: session.buyerName,
      buyerEmail: session.buyerEmail,
    })
  );
  return { kind: "fulfilled", orderId: result.orderId };
}

type FulfilResult =
  | { kind: "fulfilled"; orderId: string; productName: string; hosted: boolean }
  | { kind: "already_fulfilled" }
  | { kind: "blocked"; reason: string };

async function fulfil(
  session: PayPalSession,
  providerOrderId: string,
  providerStatus: string,
  receivedAt: Date
): Promise<FulfilResult> {
  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.paymentSession.updateMany({
        where: { id: session.id, provider: "PAYPAL", status: { not: "PAID" }, providerOrderId },
        data: { status: "PAID", providerStatus, failureReason: null, callbackReceivedAt: receivedAt },
      });
      if (claimed.count !== 1) {
        const existing = await tx.order.findFirst({
          where: {
            OR: [
              { merchantReferenceId: session.merchantReferenceId },
              { paymentProvider: "PAYPAL", providerOrderId },
            ],
          },
          select: { id: true },
        });
        return existing
          ? ({ kind: "already_fulfilled" } as const)
          : ({ kind: "blocked", reason: "not_claimable" } as const);
      }

      const product = await tx.product.findUnique({
        where: { id: session.productId },
        select: { name: true, deliveryType: true },
      });
      if (!product) throw new FulfilmentBlocked("product_missing");

      // The SAR split, from the SAR price the attempt recorded. Payouts and
      // commission are computed in SAR exactly as for Geidea.
      const split = saleBreakdown(session.amount);
      if (!split) throw new FulfilmentBlocked("amount_unparseable");

      const created = await tx.order.create({
        data: {
          productId: session.productId,
          productName: product.name,
          price: session.amount,
          customerEmail: session.buyerEmail ?? "",
          customerName: session.buyerName ?? null,
          stripeSessionId: null,
          paymentProvider: "PAYPAL",
          providerOrderId,
          merchantReferenceId: session.merchantReferenceId,
          paymentEnvironment: session.environment,
          currency: session.currency,
          grossAmount: fromHalalas(split.grossHalalas),
          platformFeeAmount: fromHalalas(split.commissionHalalas),
          sellerNetAmount: fromHalalas(split.sellerNetHalalas),
          commissionRateBps: split.rateBps,
          commissionVersion: split.version,
          founderTest: session.founderTest,
        },
        select: { id: true },
      });
      return {
        kind: "fulfilled",
        orderId: created.id,
        productName: product.name,
        hosted: product.deliveryType === "HOSTED_ACCESS",
      } as const;
    });
  } catch (error) {
    if (error instanceof FulfilmentBlocked) return { kind: "blocked", reason: error.reason };
    if (isUniqueViolation(error)) return { kind: "already_fulfilled" };
    throw error;
  }
}

/** Same receipt as a Geidea purchase: signed, dated link, only when the buyer's email is known. */
async function sendReceipt(session: PayPalSession, orderId: string, productName: string, hosted: boolean): Promise<void> {
  if (!session.buyerEmail) return;
  const base = env.NEXTAUTH_URL;
  if (!base) return;
  try {
    let reviewUrl: string | undefined;
    try {
      reviewUrl = reviewPageUrl(
        base,
        { orderId, productId: session.productId, customerEmail: session.buyerEmail },
        env.NEXTAUTH_SECRET
      );
    } catch {
      reviewUrl = undefined;
    }
    const amountPaid = { amount: session.amount, currency: session.currency };
    if (hosted) {
      await sendPurchaseEmail({
        customerEmail: session.buyerEmail,
        productName,
        downloadUrl: receiptAccessUrl(base, { orderId, productId: session.productId }, env.NEXTAUTH_SECRET),
        amountPaid,
        deliveryType: "HOSTED_ACCESS",
        reviewUrl,
      });
      return;
    }
    await sendPurchaseEmail({
      customerEmail: session.buyerEmail,
      productName,
      downloadUrl: receiptDownloadUrl(base, { orderId, productId: session.productId }, env.NEXTAUTH_SECRET),
      amountPaid,
      reviewUrl,
    });
  } catch (error) {
    payPalLog("fulfil", "warn", "receipt_failed", { error: error instanceof Error ? error.name : "Error", order: redactId(orderId) });
  }
}
