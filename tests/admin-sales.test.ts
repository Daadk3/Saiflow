/**
 * The founder's sales page: every order, real by default, with the buyer.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isRealSale, parseSaleScope, payoutStanding, saleTotals } from "../lib/admin-orders.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("real and test", () => {
  test("a real order is a live payment that is not a founder test", () => {
    assert.equal(isRealSale({ paymentEnvironment: "PRODUCTION", founderTest: false }), true);
    assert.equal(isRealSale({ paymentEnvironment: "PRODUCTION", founderTest: true }), false);
    assert.equal(isRealSale({ paymentEnvironment: "TEST", founderTest: false }), false);
    assert.equal(parseSaleScope(undefined), "real");
    assert.equal(parseSaleScope("nope"), "real");
    assert.equal(parseSaleScope("test"), "test");
    assert.equal(parseSaleScope("all"), "all");
  });

  test("payout standing matches what the payout page would pay", () => {
    const real = { paymentEnvironment: "PRODUCTION", founderTest: false, net: "9.30", payoutId: null };
    assert.equal(payoutStanding(real), "owed");
    assert.equal(payoutStanding({ ...real, payoutId: "pay_1" }), "paid");
    assert.equal(payoutStanding({ ...real, founderTest: true }), "notPayable");
    assert.equal(payoutStanding({ ...real, paymentEnvironment: "TEST" }), "notPayable");
    assert.equal(payoutStanding({ ...real, net: null }), "notPayable");
  });

  test("totals add exact money per currency and leave an unreadable row out", () => {
    const totals = saleTotals([
      { currency: "SAR", gross: "10.00", fee: "0.70", net: "9.30" },
      { currency: "SAR", gross: "1.00", fee: null, net: null },
      { currency: "SAR", gross: null, fee: null, net: null },
    ]);
    assert.deepEqual(totals, [
      { currency: "SAR", orders: 2, gross: "11.00", fee: "0.70", net: "9.30", unreadable: 1, unsplit: 1 },
    ]);
    assert.deepEqual(saleTotals([]), [
      { currency: "SAR", orders: 0, gross: "0.00", fee: "0.00", net: "0.00", unreadable: 0, unsplit: 0 },
    ]);
  });
});

describe("the page", () => {
  const page = read("app/dashboard/admin/sales/page.tsx");
  const loader = read("lib/admin-orders.ts");

  test("it lives under the admin segment and the dashboard links it beside payouts", () => {
    const layout = read("app/dashboard/admin/layout.tsx");
    assert.match(layout, /if \(!isAdminEmail\(session\.user\.email\)\) redirect\("\/dashboard"\);/);
    assert.match(read("app/dashboard/admin/page.tsx"), /href="\/dashboard\/admin\/sales"[\s\S]*?\{t\("actions\.sales"\)\}/);
    assert.match(page, /parseSaleScope/);
    assert.match(page, /t\("sales\.notCollected"\)/);
    assert.match(page, /timeZone: "Asia\/Riyadh"/);
    assert.ok(!page.includes("merchantReferenceId"));
    assert.ok(!loader.includes("merchantReferenceId"));
    assert.ok(!loader.includes("stripeSessionId"));
  });

  test("both languages name every column, and a missing name says it was not collected", () => {
    const keys = [
      "title",
      "subtitle",
      "filterReal",
      "filterTest",
      "filterAll",
      "notCollected",
      "colDate",
      "colBuyer",
      "colEmail",
      "colProduct",
      "colStore",
      "colOwner",
      "colGross",
      "colFee",
      "colNet",
      "colCurrency",
      "colPayment",
      "colPayout",
      "colEnvironment",
      "colFounderTest",
      "paid",
      "founderYes",
      "founderNo",
    ];
    for (const lang of ["ar", "en"]) {
      const sales = JSON.parse(read(`messages/${lang}.json`)).admin.sales;
      for (const key of keys) assert.ok(sales[key], `${lang} admin.sales.${key}`);
      assert.ok(sales.payout.paid && sales.payout.owed && sales.payout.notPayable, lang);
      assert.ok(JSON.parse(read(`messages/${lang}.json`)).admin.actions.sales, lang);
    }
    assert.equal(JSON.parse(read("messages/en.json")).admin.sales.notCollected, "Not collected");
    assert.match(JSON.parse(read("messages/ar.json")).admin.sales.notCollected, /لم يُجمع/);
  });

  test("the migration adds nullable name columns and nothing else", () => {
    const sql = read("prisma/migrations/20261118120000_buyer_name/migration.sql").replace(/--[^\n]*/g, "").trim();
    assert.match(sql, /ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "buyerName" TEXT;/);
    assert.match(sql, /ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerName" TEXT;/);
    assert.ok(!/NOT NULL|UPDATE|DELETE|DROP/i.test(sql));
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /buyerName\s+String\?/);
    assert.match(schema, /customerName\s+String\?/);
  });
});
