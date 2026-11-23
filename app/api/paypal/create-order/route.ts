/**
 * PayPal checkout, step 1: create a PayPal order for one product.
 *
 * Called by the PayPal JS SDK's createOrder callback on the checkout page.
 * Mirrors the Geidea checkout route's contract, which is not changed:
 *
 *   - every checkout gate runs first (lib/payments/paypal/gate), including
 *     PRE_LAUNCH_MODE, LIVE_PAYMENTS_MODE and the founder-test cap;
 *   - the body contributes only productId, buyerEmail and buyerName;
 *   - a PaymentSession is written BEFORE PayPal is asked, recording the SAR
 *     price, the USD amount PayPal will be asked for, and the fixed rate;
 *   - this is an attempt, never a purchase. Only a verified capture
 *     (app/api/paypal/capture or app/api/webhooks/paypal) creates an Order.
 *
 * PayPal attempts do not use Geidea's per-browser `currentAttemptKey`, so
 * they never block or resume a Geidea attempt.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { redactId } from "@/lib/redact-id";
import { normalizeBuyerEmail } from "@/lib/checkout/buyer-email";
import { normalizeBuyerName } from "@/lib/checkout/buyer-name";
import { createOrder, PayPalError } from "@/lib/payments/paypal/client";
import { decodePayPalOrder } from "@/lib/payments/paypal/verify";
import { payPalAccessGate, payPalSellable } from "@/lib/payments/paypal/gate";
import { payPalLog } from "@/lib/payments/paypal/fulfil";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PayPal orders stay approvable for up to three hours; used for expiry bookkeeping only. */
const ORDER_LIFETIME_MS = 3 * 60 * 60 * 1000;

function locale(req: Request): "ar-SA" | "en-US" {
  const cookie = req.headers.get("cookie") ?? "";
  return /(?:^|;\s*)NEXT_LOCALE=en(?:;|$)/.test(cookie) ? "en-US" : "ar-SA";
}

function errorFields(error: unknown) {
  if (error instanceof PayPalError) {
    return { error: error.name, status: error.status ?? undefined, paypal: error.paypalName ?? undefined, issue: error.issue ?? undefined };
  }
  return { error: error instanceof Error ? error.name : "Error" };
}

export async function POST(req: Request) {
  const gate = await payPalAccessGate();
  if (!gate.ok) {
    if (gate.refusal.reason !== "pre_launch") payPalLog("create", "warn", "refused", { reason: gate.refusal.reason });
    return NextResponse.json(gate.refusal.body, { status: gate.refusal.status });
  }

  if (!rateLimiters.checkout(getClientIp(req)).success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json({ error: "malformed" }, { status: 400 });
    }
    const productId = typeof body.productId === "string" ? body.productId : "";
    if (!productId) return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
    const buyerEmail = normalizeBuyerEmail(body.buyerEmail);
    if (buyerEmail === null) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    const buyerName = normalizeBuyerName(body.buyerName);
    if (buyerName === null) return NextResponse.json({ error: "invalid_name" }, { status: 400 });

    const sellable = await payPalSellable(productId, gate.founderTest, gate.config.sarPerUsd);
    if (!sellable.ok) {
      payPalLog("create", "warn", "refused", { reason: sellable.refusal.reason, product: productId.slice(0, 40) });
      return NextResponse.json(sellable.refusal.body, { status: sellable.refusal.status });
    }
    const { product } = sellable;

    const merchantReferenceId = randomUUID();
    let attempt: { id: string };
    try {
      attempt = await prisma.paymentSession.create({
        data: {
          merchantReferenceId,
          provider: "PAYPAL",
          productId: product.id,
          amount: product.amountSar,
          currency: "SAR",
          chargeAmount: product.amountUsd,
          chargeCurrency: "USD",
          chargeRate: gate.config.sarPerUsd,
          environment: gate.environment,
          status: "CREATED",
          buyerEmail,
          buyerName,
          expiresAt: new Date(Date.now() + ORDER_LIFETIME_MS),
          founderTest: gate.founderTest,
        },
        select: { id: true },
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2003") {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      throw error;
    }

    let orderId: string;
    try {
      const view = decodePayPalOrder(
        await createOrder(gate.config, {
          merchantReferenceId,
          amountUsd: product.amountUsd,
          description: product.name,
          locale: locale(req),
        })
      );
      if (view === null) throw new PayPalError(null, "MALFORMED_ORDER", null);
      orderId = view.id;
    } catch (error) {
      await prisma.paymentSession.updateMany({
        where: { id: attempt.id, status: "CREATED" },
        data: { status: "FAILED", failureReason: "session_create_failed" },
      });
      payPalLog("create", "warn", "order_create_failed", { attempt: attempt.id, ref: redactId(merchantReferenceId), ...errorFields(error) });
      return NextResponse.json(
        { error: "payment_unavailable", message: "PayPal could not start a checkout. Please try again." },
        { status: 502 }
      );
    }

    const stored = await prisma.paymentSession.updateMany({
      where: { id: attempt.id, status: "CREATED" },
      data: { providerOrderId: orderId, status: "SESSION_CREATED" },
    });
    if (stored.count !== 1) {
      payPalLog("create", "warn", "order_withheld", { attempt: attempt.id });
      return NextResponse.json({ error: "payment_unavailable" }, { status: 409 });
    }
    payPalLog("create", "log", "order_created", {
      attempt: attempt.id,
      ref: redactId(merchantReferenceId),
      paypalOrder: orderId,
      environment: gate.environment,
      founderTest: gate.founderTest ? "yes" : undefined,
    });

    return NextResponse.json({
      orderId,
      amountUsd: product.amountUsd,
      currency: "USD",
      statusPath: `/success?ref=${encodeURIComponent(merchantReferenceId)}`,
    });
  } catch (error) {
    payPalLog("create", "error", "unhandled", { error: error instanceof Error ? error.name : "Error" });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
