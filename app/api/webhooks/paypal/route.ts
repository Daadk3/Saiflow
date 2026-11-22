/**
 * PayPal webhook: PAYMENT.CAPTURE.COMPLETED.
 *
 * The safety net for a buyer who approved and was captured but whose browser
 * never reached the capture route's answer (closed tab, lost connection).
 * Every other event type is acknowledged and ignored.
 *
 * AN EVENT CAN CREATE AN ORDER ONLY WHEN ALL OF THESE HOLD, IN THIS ORDER:
 *
 *   1. The body is JSON within MAX_BODY_BYTES and every PayPal transmission
 *      header is present.
 *   2. PayPal's verify-webhook-signature API answers SUCCESS for this
 *      delivery against OUR configured PAYPAL_WEBHOOK_ID. Nothing in the
 *      database is read before this.
 *   3. The capture names a PayPal order id that a PayPal PaymentSession of
 *      ours recorded, on the PayPal account this deployment is configured for.
 *   4. PayPal, asked directly for that order (authenticated GET), says it is
 *      COMPLETED for our merchant reference with exactly one COMPLETED USD
 *      capture for the amount the attempt recorded.
 *
 * IDEMPOTENT. A repeated delivery of the same event, or the capture route
 * having fulfilled first, finds the attempt PAID and answers 200
 * "already_fulfilled" without asking PayPal again, without a second Order
 * and without a second receipt (lib/payments/paypal/fulfil).
 *
 * Plain `Response`, like the Geidea callback, so the test runner can drive it.
 */

import { prisma } from "@/lib/prisma";
import { redactId } from "@/lib/redact-id";
import { getOrder, PAYPAL_ORDER_ID, verifyWebhookSignature } from "@/lib/payments/paypal/client";
import { payPalConfig, payPalEnvironment } from "@/lib/payments/paypal/config";
import { decodePayPalOrder } from "@/lib/payments/paypal/verify";
import { PAYPAL_SESSION_SELECT, payPalLog, settlePayPalOrder } from "@/lib/payments/paypal/fulfil";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const CAPTURE_COMPLETED = "PAYMENT.CAPTURE.COMPLETED";

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, must-revalidate" },
  });
}

const log = (level: "log" | "warn" | "error", event: string, fields: Record<string, string | number | null | undefined> = {}) =>
  payPalLog("webhook", level, event, fields);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** PayPal only serves its signing certificates over https from its own hosts. */
function plausibleCertUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"));
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await handle(req);
  } catch (error) {
    log("error", "unhandled", { error: error instanceof Error ? error.name : "Error" });
    return reply(500, { error: "internal" });
  }
}

async function handle(req: Request): Promise<Response> {
  const config = payPalConfig();
  if (config === null) {
    log("error", "not_configured");
    return reply(503, { error: "not_configured" });
  }

  // 1. Shape.
  let text: string;
  try {
    text = await req.text();
  } catch {
    return reply(400, { error: "malformed" });
  }
  if (text.length > MAX_BODY_BYTES) return reply(413, { error: "too_large" });
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    return reply(400, { error: "malformed" });
  }
  if (!isObj(event)) return reply(400, { error: "malformed" });

  const h = req.headers;
  const headers = {
    authAlgo: h.get("paypal-auth-algo") ?? "",
    certUrl: h.get("paypal-cert-url") ?? "",
    transmissionId: h.get("paypal-transmission-id") ?? "",
    transmissionSig: h.get("paypal-transmission-sig") ?? "",
    transmissionTime: h.get("paypal-transmission-time") ?? "",
  };
  if (Object.values(headers).some((v) => v.length === 0 || v.length > 2048) || !plausibleCertUrl(headers.certUrl)) {
    log("warn", "rejected", { reason: "headers" });
    return reply(400, { error: "invalid_signature" });
  }

  // 2. PayPal verifies the delivery against our webhook id. Before any database access.
  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(config, headers, event);
  } catch {
    log("warn", "verification_unavailable");
    return reply(503, { error: "verification_unavailable" });
  }
  if (!verified) {
    log("warn", "rejected", { reason: "signature" });
    return reply(400, { error: "invalid_signature" });
  }

  const eventType = typeof event.event_type === "string" ? event.event_type.slice(0, 64) : "";
  if (eventType !== CAPTURE_COMPLETED) {
    return reply(200, { received: true, result: "ignored" });
  }

  // 3. The attempt this capture belongs to.
  const resource = isObj(event.resource) ? event.resource : {};
  const supplementary = isObj(resource.supplementary_data) ? resource.supplementary_data : {};
  const related = isObj(supplementary.related_ids) ? supplementary.related_ids : {};
  const orderId = typeof related.order_id === "string" ? related.order_id : "";
  if (!PAYPAL_ORDER_ID.test(orderId)) {
    log("warn", "rejected", { reason: "order_id" });
    return reply(400, { error: "malformed" });
  }

  const session = await prisma.paymentSession.findUnique({
    where: { provider_providerOrderId: { provider: "PAYPAL", providerOrderId: orderId } },
    select: PAYPAL_SESSION_SELECT,
  });
  if (!session) {
    // Not an order this deployment created. Acknowledged so PayPal stops retrying.
    log("warn", "unknown_order", { paypalOrder: orderId });
    return reply(200, { received: true, result: "unknown_order" });
  }
  const ids = { session: session.id, ref: redactId(session.merchantReferenceId), paypalOrder: orderId };
  if (session.environment !== payPalEnvironment(config.env)) {
    log("warn", "rejected", { reason: "environment", ...ids });
    return reply(409, { error: "mismatch" });
  }

  // A capture carries our reference as custom_id; when present it must agree.
  if (typeof resource.custom_id === "string" && resource.custom_id !== session.merchantReferenceId) {
    log("warn", "rejected", { reason: "custom_id", ...ids });
    return reply(409, { error: "mismatch" });
  }

  // Repeated delivery, or the capture route fulfilled first: nothing more to do.
  if (session.status === "PAID") {
    const existing = await prisma.order.findUnique({
      where: { merchantReferenceId: session.merchantReferenceId },
      select: { id: true },
    });
    if (existing) {
      log("log", "duplicate", ids);
      return reply(200, { received: true, result: "already_fulfilled" });
    }
  }

  // 4. PayPal's own account of the order, authenticated.
  let raw: unknown;
  try {
    raw = await getOrder(config, orderId);
  } catch {
    log("warn", "inquiry_failed", ids);
    return reply(503, { error: "verification_unavailable" });
  }
  const view = decodePayPalOrder(raw);
  if (view === null) {
    log("warn", "rejected", { reason: "inquiry_malformed", ...ids });
    return reply(503, { error: "verification_unavailable" });
  }

  const result = await settlePayPalOrder(session, view, "webhook");
  switch (result.kind) {
    case "fulfilled":
      return reply(200, { received: true, result: "fulfilled" });
    case "already_fulfilled":
      return reply(200, { received: true, result: "already_fulfilled" });
    case "pending":
      return reply(200, { received: true, result: "recorded" });
    case "failed":
      return reply(200, { received: true, result: "failed" });
    case "mismatch":
      return reply(409, { error: "mismatch" });
    case "blocked":
      return reply(409, { error: "fulfilment_blocked" });
  }
}
