/**
 * Geidea Checkout v2 — the callback.
 *
 * Geidea posts here when a hosted-page payment finishes. This handler is the
 * only place a Geidea purchase becomes an Order, and an Order is what every
 * download is authorised on, so the bar is the highest in the codebase.
 *
 * A CALLBACK IS ACCEPTED AS PAID ONLY WHEN ALL OF THESE HOLD, IN THIS ORDER:
 *
 *   1. The body decodes to the documented shape. Unknown fields are dropped,
 *      every id is a UUID, every string is bounded.
 *   2. Its signature verifies, in constant time, against OUR configured
 *      merchant public key and API password. The payload's own copy of the
 *      public key is ignored: the trust anchor is configuration, never input.
 *   3. It names a PaymentSession we created, by merchantReferenceId.
 *   4. It agrees with that attempt on provider (GEIDEA), environment (the
 *      deployment's own GEIDEA_ENV, cross-checked against the callback's own
 *      `isTest`), amount as a canonical two-decimal string, currency, the
 *      provider session id when one was recorded, the provider order id when
 *      one was recorded, and a payment operation of "Pay".
 *   5. It carries every documented success value, where Geidea actually puts
 *      them: order status "Success", detailed status "Paid", and a "Pay"
 *      transaction with status "Success" whose codes are responseCode "000",
 *      detailedResponseCode "000", responseMessage "Success" and
 *      detailedResponseMessage "The operation was successful".
 *   6. Geidea, asked directly through the authenticated order inquiry, agrees
 *      on order id, merchant reference, amount, currency and paid status.
 *
 * Failing 1 or 2 is answered with 400 and no database access at all. Failing
 * 3 is 404. Failing 4 is 409, and the attempt is left untouched: an authentic
 * callback that disagrees with what we meant to sell is an incident, not a
 * sale and not a failure. Failing 6 is 409 (disagreement) or 503 (the inquiry
 * could not be made), and again the attempt is left for investigation or a
 * retry. A callback that fails only 5 is authentic and understood: it moves
 * the attempt to FAILED, CANCELLED or EXPIRED, or is merely recorded when it
 * decides nothing, and it never creates an Order.
 *
 * FULFILMENT IS ONE TRANSACTION AND IS IDEMPOTENT. Inside it, a conditional
 * update claims the attempt (status is not PAID, and the provider order id is
 * unset or this one), then exactly one Order is created. A second callback
 * for the same payment finds the attempt already PAID and answers 200
 * without a second inquiry, a second write, or a second receipt. Two
 * callbacks racing each other are settled by the database: the update
 * claims for one of them, and the unique constraints on the Order's
 * merchant reference and provider order id refuse the other even if it got
 * that far.
 *
 * WHAT THIS HANDLER NEVER DOES: read a buyer's email from the callback, treat
 * an email as part of authorisation, consult the attempt as proof of
 * purchase, decide delivery (the download gate does that, on its own terms),
 * or log a payload, a signature, a credential or a card. Logs carry an event
 * name, a reason, and identifiers.
 *
 * Plain `Response`, not NextResponse: nothing here needs Next.js, and a
 * handler built on web standards alone can be exercised by the test runner
 * without Next.js loaded.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { sendPurchaseEmail } from "@/lib/email";
import {
  geideaMode,
  getOrder,
  isGeideaConfigured,
} from "@/lib/payments/geidea/client";
import type { GeideaOrder } from "@/lib/payments/geidea/client";
import { verifyCallbackSignature } from "@/lib/payments/geidea/signature";
import { redactId } from "@/lib/redact-id";
import {
  MAX_CALLBACK_BYTES,
  canonicalAmount,
  classifyCallback,
  decodeCallbackPayload,
  failureReasonFor,
  inquiryDisagreement,
  latestPayCodes,
  providerStatusSummary,
} from "@/lib/payments/geidea/callback";
import type { GeideaCallbackPayload } from "@/lib/payments/geidea/callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "TEST" | "PRODUCTION";

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

type LogFields = Record<string, string | number | null | undefined>;

/**
 * Identifiers and reasons only. Nothing that arrives in a callback is ever
 * passed here except the two short response codes and the UUIDs.
 */
function log(level: "log" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const text = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console[level](`[Geidea callback] ${event}${text.length > 0 ? ` ${text}` : ""}`);
}

/** Only the class name. A message can carry a URL, a body, or worse. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

const SESSION_SELECT = {
  id: true,
  merchantReferenceId: true,
  provider: true,
  environment: true,
  amount: true,
  currency: true,
  status: true,
  productId: true,
  providerSessionId: true,
  providerOrderId: true,
  buyerEmail: true,
} as const;

async function loadSession(merchantReferenceId: string) {
  return prisma.paymentSession.findUnique({
    where: { merchantReferenceId },
    select: SESSION_SELECT,
  });
}

type Session = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

/* ------------------------------------------------------------------ */
/* The handler                                                         */
/* ------------------------------------------------------------------ */

export async function POST(req: Request): Promise<Response> {
  try {
    return await handle(req);
  } catch (error) {
    // Never the message: it could quote a body or a URL.
    log("error", "unhandled", { error: errorName(error) });
    return reply(500, { error: "internal" });
  }
}

async function handle(req: Request): Promise<Response> {
  const merchantPublicKey = env.GEIDEA_MERCHANT_PUBLIC_KEY;
  const apiPassword = env.GEIDEA_API_PASSWORD;
  const configuredMode = geideaMode();
  if (!isGeideaConfigured() || !merchantPublicKey || !apiPassword || configuredMode === null) {
    log("error", "not_configured");
    return reply(503, { error: "not_configured" });
  }
  const mode: Mode = configuredMode === "production" ? "PRODUCTION" : "TEST";

  // 1. Decode. Nothing below runs on a body that is not the documented shape.
  let text: string;
  try {
    text = await req.text();
  } catch {
    return reply(400, { error: "malformed" });
  }
  if (text.length > MAX_CALLBACK_BYTES) {
    log("warn", "rejected", { reason: "too_large" });
    return reply(413, { error: "too_large" });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    log("warn", "rejected", { reason: "malformed", path: "$" });
    return reply(400, { error: "malformed" });
  }
  const decoded = decodeCallbackPayload(raw);
  if (!decoded.ok) {
    log("warn", "rejected", { reason: "malformed", path: decoded.path });
    return reply(400, { error: "malformed" });
  }
  const payload = decoded.payload;
  const { order } = payload;
  // The reference is a download bearer once the purchase is fulfilled, so it
  // is logged redacted. Geidea's order id is not a SaiFlow credential.
  const ids = { ref: redactId(order.merchantReferenceId), orderId: order.orderId };

  // 2. Authenticate, before any database access. Our key, our password.
  const verification = verifyCallbackSignature(
    {
      merchantPublicKey,
      amount: order.amount,
      currency: order.currency,
      orderId: order.orderId,
      status: order.status,
      merchantReferenceId: order.merchantReferenceId,
      timeStamp: payload.timeStamp,
    },
    payload.signature,
    apiPassword
  );
  if (!verification.ok) {
    log("warn", "rejected", { reason: verification.reason, ...ids });
    return reply(400, { error: "invalid_signature" });
  }

  // 3. The attempt this callback claims to settle.
  const session = await loadSession(order.merchantReferenceId);
  if (!session) {
    log("warn", "rejected", { reason: "unknown_reference", ...ids });
    return reply(404, { error: "unknown_reference" });
  }

  // 4. What we meant to sell, versus what the callback says was sold.
  const mismatch = localMismatch(session, payload, mode);
  if (mismatch !== null) {
    log("warn", "rejected", { reason: `mismatch:${mismatch}`, session: session.id, ...ids });
    return reply(409, { error: "mismatch" });
  }

  // 5. What the callback says happened.
  const outcome = classifyCallback(payload);
  const providerStatus = providerStatusSummary(order.status, order.detailedStatus);
  const receivedAt = new Date();
  const codes = latestPayCodes(order);
  log("log", "received", {
    outcome,
    session: session.id,
    responseCode: codes?.responseCode,
    detailedResponseCode: codes?.detailedResponseCode,
    ...ids,
  });

  if (outcome === "paid") {
    return fulfilPaid(session, payload, mode, providerStatus, receivedAt);
  }

  // The provider order id is recorded once, and only if none was known.
  const orderIdIfNew =
    session.providerOrderId === null ? { providerOrderId: order.orderId } : {};

  if (outcome === "indeterminate") {
    // Understood but undecided ("InProgress", or a self-contradictory
    // payload). Recorded for support; status untouched; never an Order.
    await prisma.paymentSession.updateMany({
      where: { id: session.id, status: { not: "PAID" } },
      data: { providerStatus, callbackReceivedAt: receivedAt, ...orderIdIfNew },
    });
    return reply(200, { received: true, result: "recorded" });
  }

  // cancelled, expired, failed: the attempt closes, and nothing else moves.
  // `status: { not: "PAID" }` means a paid attempt is never downgraded by a
  // late or repeated failure callback.
  const closed = await prisma.paymentSession.updateMany({
    where: { id: session.id, status: { not: "PAID" } },
    data: {
      status:
        outcome === "cancelled" ? "CANCELLED" : outcome === "expired" ? "EXPIRED" : "FAILED",
      providerStatus,
      failureReason: failureReasonFor(outcome),
      callbackReceivedAt: receivedAt,
      ...orderIdIfNew,
    },
  });
  return reply(200, { received: true, result: closed.count === 1 ? outcome : "ignored" });
}

/**
 * Every way the callback can disagree with the attempt, checked before the
 * outcome is even looked at. Amounts are compared as canonical two-decimal
 * strings on both sides: the stored Decimal renders itself exactly, and the
 * callback's number or string goes through the same formatter.
 */
function localMismatch(session: Session, payload: GeideaCallbackPayload, mode: Mode): string | null {
  const { order } = payload;
  if (session.merchantReferenceId !== order.merchantReferenceId) return "reference";
  if (session.provider !== "GEIDEA") return "provider";
  if (session.environment !== mode) return "environment";
  const expected = canonicalAmount(session.amount);
  const actual = canonicalAmount(order.amount);
  if (expected === null || actual === null || expected !== actual) return "amount";
  if (session.currency !== order.currency) return "currency";
  if (session.providerOrderId !== null && session.providerOrderId !== order.orderId) {
    return "order_id";
  }
  // Geidea states which of its accounts the order belongs to; it must be
  // the one this deployment is configured for.
  if (order.isTest !== null && order.isTest !== (mode === "TEST")) return "is_test";
  // The session the callback names must be the one the attempt recorded,
  // once the attempt records one. Both copies of the id are checked.
  if (session.providerSessionId !== null) {
    for (const claimed of [order.sessionId, payload.sessionId]) {
      if (claimed !== null && claimed.toLowerCase() !== session.providerSessionId.toLowerCase()) {
        return "session_id";
      }
    }
  }
  // SaiFlow only ever creates "Pay" sessions.
  if (order.paymentOperation !== null && order.paymentOperation !== "Pay") {
    return "payment_operation";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Paid                                                                */
/* ------------------------------------------------------------------ */

async function fulfilPaid(
  session: Session,
  payload: GeideaCallbackPayload,
  mode: Mode,
  providerStatus: string,
  receivedAt: Date
): Promise<Response> {
  const { order } = payload;
  const ids = { ref: redactId(session.merchantReferenceId), orderId: order.orderId, session: session.id };

  // Already fulfilled: say so and stop. No inquiry, no write, no receipt.
  if (session.status === "PAID") {
    const existing = await prisma.order.findUnique({
      where: { merchantReferenceId: session.merchantReferenceId },
      select: { id: true },
    });
    if (existing) {
      log("log", "duplicate", { order: redactId(existing.id), ...ids });
      return reply(200, { received: true, result: "already_fulfilled" });
    }
  }

  // 6. Defence in depth: Geidea's own account of the order, authenticated.
  let inquiry: GeideaOrder;
  try {
    inquiry = await getOrder(order.orderId);
  } catch (error) {
    log("warn", "inquiry_failed", { error: errorName(error), ...ids });
    return reply(503, { error: "verification_unavailable" });
  }
  const expectedAmount = canonicalAmount(session.amount);
  if (expectedAmount === null) {
    log("error", "rejected", { reason: "stored_amount_unreadable", ...ids });
    return reply(409, { error: "mismatch" });
  }
  const disagreement = inquiryDisagreement(inquiry, {
    orderId: order.orderId,
    merchantReferenceId: session.merchantReferenceId,
    amount: expectedAmount,
    currency: session.currency,
  });
  if (disagreement !== null) {
    log("warn", "rejected", { reason: `inquiry:${disagreement}`, ...ids });
    return reply(409, { error: "verification_mismatch" });
  }

  const result = await fulfil(session, order.orderId, mode, providerStatus, receivedAt);
  if (result.kind === "blocked") {
    log("error", "fulfilment_blocked", { reason: result.reason, ...ids });
    return reply(409, { error: "fulfilment_blocked" });
  }
  if (result.kind === "already_fulfilled") {
    log("log", "duplicate", ids);
    return reply(200, { received: true, result: "already_fulfilled" });
  }

  // The Order id is the receipt channel's bearer: redacted like the reference.
  log("log", "fulfilled", { order: redactId(result.orderId), ...ids });
  await sendReceipt(session, result.orderId, result.productName);
  return reply(200, { received: true, result: "fulfilled" });
}

class FulfilmentBlocked extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`fulfilment blocked: ${reason}`);
    this.name = "FulfilmentBlocked";
    this.reason = reason;
  }
}

type FulfilResult =
  | { kind: "fulfilled"; orderId: string; productName: string }
  | { kind: "already_fulfilled" }
  | { kind: "blocked"; reason: string };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * The one transaction that turns an attempt into a purchase.
 *
 * The claim is a conditional update, the repository's concurrency primitive
 * (see the scan lease in lib/scan): it moves the attempt to PAID only if it
 * is not PAID already and its provider order id is unset or this one. Exactly
 * one of any number of concurrent callers sees count 1; the rest see 0 and
 * report the existing Order instead of creating another. Should two claims
 * somehow both succeed, the Order's unique merchant reference and unique
 * provider order id make the second insert fail, which rolls that
 * transaction back and is reported as already fulfilled.
 *
 * The Order is built from the attempt, never from the callback: the stored
 * amount, the stored currency, the stored product. The callback contributed
 * only the provider order id, which the inquiry has already confirmed.
 */
async function fulfil(
  session: Session,
  providerOrderId: string,
  mode: Mode,
  providerStatus: string,
  receivedAt: Date
): Promise<FulfilResult> {
  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.paymentSession.updateMany({
        where: {
          id: session.id,
          status: { not: "PAID" },
          OR: [{ providerOrderId: null }, { providerOrderId }],
        },
        data: {
          status: "PAID",
          providerOrderId,
          providerStatus,
          failureReason: null,
          callbackReceivedAt: receivedAt,
        },
      });

      if (claimed.count !== 1) {
        const existing = await tx.order.findFirst({
          where: {
            OR: [
              { merchantReferenceId: session.merchantReferenceId },
              { paymentProvider: "GEIDEA", providerOrderId },
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
        select: { name: true },
      });
      if (!product) throw new FulfilmentBlocked("product_missing");

      const created = await tx.order.create({
        data: {
          productId: session.productId,
          productName: product.name,
          price: session.amount,
          // Email is never part of authorisation. Known: kept for the
          // receipt. Unknown: empty, and the receipt waits for a later step.
          customerEmail: session.buyerEmail ?? "",
          stripeSessionId: null,
          paymentProvider: "GEIDEA",
          providerOrderId,
          merchantReferenceId: session.merchantReferenceId,
          paymentEnvironment: mode,
          currency: session.currency,
        },
        select: { id: true },
      });

      return { kind: "fulfilled", orderId: created.id, productName: product.name } as const;
    });
  } catch (error) {
    if (error instanceof FulfilmentBlocked) return { kind: "blocked", reason: error.reason };
    if (isUniqueViolation(error)) return { kind: "already_fulfilled" };
    throw error;
  }
}

/**
 * The receipt, after the purchase is committed and only when the buyer's
 * email was already known to the attempt. The link is the download route's
 * email channel, the same one the Stripe receipt uses. A failure here is
 * logged and does not change the response: the purchase exists either way.
 */
async function sendReceipt(session: Session, orderId: string, productName: string): Promise<void> {
  if (!session.buyerEmail) return;
  const base = env.NEXTAUTH_URL;
  if (!base) {
    log("warn", "receipt_skipped", { reason: "no_site_url", order: redactId(orderId) });
    return;
  }
  try {
    await sendPurchaseEmail({
      customerEmail: session.buyerEmail,
      productName,
      downloadUrl: `${base}/api/download/${encodeURIComponent(session.productId)}?orderId=${encodeURIComponent(orderId)}`,
    });
  } catch (error) {
    log("warn", "receipt_failed", { error: errorName(error), order: redactId(orderId) });
  }
}
