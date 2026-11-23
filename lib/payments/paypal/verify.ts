/**
 * Whether a PayPal order is proof of payment for one SaiFlow attempt.
 *
 * Pure: it reads a PayPal order (the capture response or a GET of the
 * order, same shape) and the attempt's stored values, and answers. The
 * capture route and the webhook route both use it, so an Order can only
 * exist when PayPal itself says, for THIS order id and THIS merchant
 * reference, that a capture COMPLETED for exactly the USD amount the
 * attempt recorded.
 *
 *   paid          order COMPLETED, reference matches, one capture COMPLETED
 *                 in USD for exactly chargeAmount
 *   mismatch      PayPal's answer disagrees with what we meant to sell:
 *                 another order id or reference, another currency or
 *                 amount. An incident, never a sale and never a failure.
 *   failed        PayPal says the payment did not go through (DECLINED,
 *                 FAILED, VOIDED)
 *   pending       not decided yet (APPROVED but uncaptured, PENDING capture)
 */

export interface PayPalCapture {
  id: string;
  status: string;
  currency: string | null;
  value: string | null;
}

export interface PayPalOrderView {
  id: string;
  status: string;
  referenceId: string | null;
  customId: string | null;
  captures: PayPalCapture[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 128): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** The parts of a PayPal order this file reads, or null when it is not an order. */
export function decodePayPalOrder(raw: unknown): PayPalOrderView | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 64);
  const status = str(raw.status, 32);
  if (!id || !status) return null;
  const units = Array.isArray(raw.purchase_units) ? raw.purchase_units : [];
  const unit = isObj(units[0]) ? units[0] : {};
  const payments = isObj(unit.payments) ? unit.payments : {};
  const rawCaptures = Array.isArray(payments.captures) ? payments.captures : [];
  const captures: PayPalCapture[] = [];
  for (const c of rawCaptures.slice(0, 10)) {
    if (!isObj(c)) continue;
    const cid = str(c.id, 64);
    const cstatus = str(c.status, 32);
    if (!cid || !cstatus) continue;
    const amount = isObj(c.amount) ? c.amount : {};
    captures.push({ id: cid, status: cstatus, currency: str(amount.currency_code, 3), value: str(amount.value, 32) });
  }
  return {
    id,
    status,
    referenceId: str(unit.reference_id, 256),
    customId: str(unit.custom_id, 256),
    captures,
  };
}

export interface ExpectedPayment {
  /** The PayPal order id recorded on the attempt. */
  orderId: string;
  merchantReferenceId: string;
  /** Canonical two-decimal USD the attempt asked PayPal to charge. */
  amountUsd: string;
  currency: "USD";
}

export type CaptureVerdict =
  | { kind: "paid"; captureId: string }
  | { kind: "mismatch"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "pending"; reason: string };

/** "13.1" → "13.10"; anything not a plain non-negative decimal → null. */
function canonicalUsd(value: string | null): string | null {
  if (value === null || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  return `${Number(whole)}.${frac.padEnd(2, "0")}`;
}

export function captureVerdict(order: PayPalOrderView, expected: ExpectedPayment): CaptureVerdict {
  if (order.id !== expected.orderId) return { kind: "mismatch", reason: "order_id" };
  // The reference we put on the order must come back. custom_id is checked
  // as well when PayPal returns it.
  if (order.referenceId !== null && order.referenceId !== expected.merchantReferenceId) {
    return { kind: "mismatch", reason: "reference" };
  }
  if (order.customId !== null && order.customId !== expected.merchantReferenceId) {
    return { kind: "mismatch", reason: "custom_id" };
  }
  if (order.referenceId === null && order.customId === null) return { kind: "mismatch", reason: "reference_missing" };

  if (order.status === "VOIDED") return { kind: "failed", reason: "voided" };
  const completed = order.captures.filter((c) => c.status === "COMPLETED");
  for (const c of completed) {
    if (c.currency !== expected.currency) return { kind: "mismatch", reason: "currency" };
    if (canonicalUsd(c.value) !== expected.amountUsd) return { kind: "mismatch", reason: "amount" };
  }
  if (completed.length > 1) return { kind: "mismatch", reason: "multiple_captures" };
  if (order.status === "COMPLETED" && completed.length === 1) {
    return { kind: "paid", captureId: completed[0].id };
  }
  if (order.captures.some((c) => c.status === "DECLINED" || c.status === "FAILED")) {
    return { kind: "failed", reason: "declined" };
  }
  return { kind: "pending", reason: order.status.toLowerCase().slice(0, 24) };
}
