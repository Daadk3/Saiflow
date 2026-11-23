/**
 * The pure parts of the PayPal integration: SAR → USD conversion, the fixed
 * rate's parsing, and the capture verdict that decides whether PayPal's
 * answer is proof of payment.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sarToUsd } from "../lib/payments/paypal/convert.ts";
import { captureVerdict, decodePayPalOrder } from "../lib/payments/paypal/verify.ts";

describe("sarToUsd", () => {
  test("converts at the fixed rate and rounds half-up to the cent", () => {
    assert.equal(sarToUsd("49.00", "3.75"), "13.07");
    assert.equal(sarToUsd("3.75", "3.75"), "1.00");
    assert.equal(sarToUsd("10.00", "3.75"), "2.67");
    assert.equal(sarToUsd("375.00", "3.75"), "100.00");
    assert.equal(sarToUsd("0.02", "3.75"), "0.01");
    assert.equal(sarToUsd("99999999.99", "3.75"), "26666666.66");
  });
  test("refuses what it cannot convert", () => {
    assert.equal(sarToUsd("0.00", "3.75"), null);
    assert.equal(sarToUsd("0.01", "3.75"), null, "rounds to zero cents");
    assert.equal(sarToUsd("49", "3.75"), null, "not canonical");
    assert.equal(sarToUsd("49.00", "0"), null);
    assert.equal(sarToUsd("49.00", "-3.75"), null);
    assert.equal(sarToUsd("49.00", "abc"), null);
  });
});

const REF = "7d3c1a40-2b1e-4c55-9d0e-9a1b2c3d4e5f";
const order = (over: Record<string, unknown> = {}, capture: Record<string, unknown> = {}) =>
  decodePayPalOrder({
    id: "5O190127TN364715T",
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: REF,
        custom_id: REF,
        payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "13.07" }, ...capture }] },
      },
    ],
    ...over,
  })!;
const expected = { orderId: "5O190127TN364715T", merchantReferenceId: REF, amountUsd: "13.07", currency: "USD" as const };

describe("captureVerdict", () => {
  test("paid only for the right order, reference, currency and exact amount", () => {
    assert.deepEqual(captureVerdict(order(), expected), { kind: "paid", captureId: "CAP1" });
  });
  test("an amount that differs is a mismatch, even by a cent", () => {
    assert.deepEqual(captureVerdict(order({}, { amount: { currency_code: "USD", value: "13.06" } }), expected), {
      kind: "mismatch",
      reason: "amount",
    });
  });
  test("an equal amount written differently still matches", () => {
    assert.equal(captureVerdict(order({}, { amount: { currency_code: "USD", value: "13.070" } }), expected).kind, "mismatch");
    assert.equal(
      captureVerdict(order({}, { amount: { currency_code: "USD", value: "13.1" } }), { ...expected, amountUsd: "13.10" }).kind,
      "paid"
    );
  });
  test("another currency, order or reference is a mismatch", () => {
    assert.equal(captureVerdict(order({}, { amount: { currency_code: "SAR", value: "13.07" } }), expected).kind, "mismatch");
    assert.equal(captureVerdict(order({ id: "OTHER0RDER123" }), expected).kind, "mismatch");
    assert.equal(captureVerdict(order(), { ...expected, merchantReferenceId: "x" }).kind, "mismatch");
  });
  test("not COMPLETED is never paid", () => {
    assert.equal(captureVerdict(order({ status: "APPROVED" }, { status: "PENDING" }), expected).kind, "pending");
    assert.equal(captureVerdict(order({ status: "APPROVED" }, { status: "DECLINED" }), expected).kind, "failed");
    assert.equal(captureVerdict(order({ status: "VOIDED" }), expected).kind, "failed");
  });
  test("a non-order is not decoded", () => {
    assert.equal(decodePayPalOrder(null), null);
    assert.equal(decodePayPalOrder({ status: "COMPLETED" }), null);
  });
});
