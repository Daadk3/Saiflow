/**
 * PayPal checkout, step 2: capture an approved order.
 *
 * Called by the PayPal JS SDK's onApprove callback with PayPal's order id
 * and nothing else. Which attempt, which amount and which currency all come
 * from the PaymentSession the create route wrote, never from the browser.
 *
 * An Order is created ONLY after PayPal's own capture response says the
 * order is COMPLETED, for our merchant reference, with one COMPLETED capture
 * in USD for exactly the amount the attempt recorded
 * (lib/payments/paypal/verify). Anything else leaves no Order. The capture
 * carries a PayPal-Request-Id, so a retried click cannot capture twice; and
 * fulfilment is idempotent with the webhook (lib/payments/paypal/fulfil),
 * so whichever of the two arrives first creates the one Order.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { redactId } from "@/lib/redact-id";
import { captureOrder, getOrder, PayPalError, PAYPAL_ORDER_ID } from "@/lib/payments/paypal/client";
import { decodePayPalOrder } from "@/lib/payments/paypal/verify";
import { payPalAccessGate } from "@/lib/payments/paypal/gate";
import { PAYPAL_SESSION_SELECT, payPalLog, settlePayPalOrder } from "@/lib/payments/paypal/fulfil";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusPathFor(ref: string): string {
  return `/success?ref=${encodeURIComponent(ref)}`;
}

export async function POST(req: Request) {
  const gate = await payPalAccessGate();
  if (!gate.ok) return NextResponse.json(gate.refusal.body, { status: gate.refusal.status });

  if (!rateLimiters.checkout(getClientIp(req)).success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    let orderId = "";
    try {
      const parsed = (await req.json()) as { orderId?: unknown } | null;
      orderId = typeof parsed?.orderId === "string" ? parsed.orderId : "";
    } catch {
      orderId = "";
    }
    if (!PAYPAL_ORDER_ID.test(orderId)) return NextResponse.json({ error: "malformed" }, { status: 400 });

    const session = await prisma.paymentSession.findUnique({
      where: { provider_providerOrderId: { provider: "PAYPAL", providerOrderId: orderId } },
      select: PAYPAL_SESSION_SELECT,
    });
    if (!session) return NextResponse.json({ error: "unknown_order" }, { status: 404 });
    const ids = { session: session.id, ref: redactId(session.merchantReferenceId), paypalOrder: orderId };
    const statusPath = statusPathFor(session.merchantReferenceId);

    // An attempt made against another PayPal account than the one configured now.
    if (session.environment !== gate.environment) {
      payPalLog("capture", "warn", "rejected", { reason: "environment", ...ids });
      return NextResponse.json({ error: "mismatch" }, { status: 409 });
    }

    if (session.status === "PAID") {
      return NextResponse.json({ result: "paid", statusPath });
    }

    let raw: unknown;
    try {
      raw = await captureOrder(gate.config, orderId, session.merchantReferenceId);
    } catch (error) {
      if (error instanceof PayPalError && error.issue === "ORDER_ALREADY_CAPTURED") {
        // Captured already (the webhook, or an earlier click): read PayPal's account of it.
        try {
          raw = await getOrder(gate.config, orderId);
        } catch {
          payPalLog("capture", "warn", "inquiry_failed", ids);
          return NextResponse.json({ error: "verification_unavailable", statusPath }, { status: 503 });
        }
      } else if (error instanceof PayPalError && error.issue === "INSTRUMENT_DECLINED") {
        // PayPal's documented recovery: let the buyer choose another funding source.
        payPalLog("capture", "log", "instrument_declined", ids);
        return NextResponse.json({ error: "instrument_declined" }, { status: 422 });
      } else {
        const e = error instanceof PayPalError ? error : null;
        payPalLog("capture", "warn", "capture_failed", {
          ...ids,
          status: e?.status ?? undefined,
          paypal: e?.paypalName ?? undefined,
          issue: e?.issue ?? undefined,
        });
        return NextResponse.json({ error: "capture_failed", statusPath }, { status: 502 });
      }
    }

    const view = decodePayPalOrder(raw);
    if (view === null) {
      payPalLog("capture", "warn", "rejected", { reason: "malformed", ...ids });
      return NextResponse.json({ error: "verification_unavailable", statusPath }, { status: 503 });
    }

    const result = await settlePayPalOrder(session, view, "capture");
    switch (result.kind) {
      case "fulfilled":
      case "already_fulfilled":
        return NextResponse.json({ result: "paid", statusPath });
      case "pending":
        return NextResponse.json({ result: "pending", statusPath }, { status: 202 });
      case "failed":
        return NextResponse.json({ error: "payment_declined", statusPath }, { status: 402 });
      case "mismatch":
        return NextResponse.json({ error: "mismatch" }, { status: 409 });
      case "blocked":
        return NextResponse.json({ error: "fulfilment_blocked", statusPath }, { status: 409 });
    }
  } catch (error) {
    payPalLog("capture", "error", "unhandled", { error: error instanceof Error ? error.name : "Error" });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
