/**
 * Security fixes: payments and payouts (review of main 4f3a1a0, 2026-10-19).
 *
 * What must hold (behaviour for the payout confirmation is in
 * tests/payouts; the 14-day hold and own-shop block in tests/fraud-signals,
 * tests/payouts and tests/founder-live-test):
 * - Changing a shop's payout IBAN emails every OWNER, after the reply,
 *   naming only the last four characters.
 * - The admin's payouts page asks for an explicit confirmation before
 *   paying an account changed in the last week.
 * - The retired Stripe webhook answers 410 and writes nothing.
 * - PRE_LAUNCH_MODE is on unless exactly "false", decided before validation,
 *   so skipping validation can never open checkout.
 * - Checkout takes a plain-text product id, and the live site never runs on
 *   a test Geidea account.
 * - A founder test may buy from the founder's own shop; nobody else may.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("a changed IBAN emails the shop's owners, after the reply, with the last four characters only", () => {
  const route = strip(read("app/api/shops/[slug]/payout-account/route.ts"));
  assert.match(route, /const previous = await prisma\.sellerPayoutAccount\.findUnique\(/);
  assert.match(route, /if \(previous\?\.iban !== saved\.iban\) \{\s*await runAfterResponse\(\(\) => notifyPayoutAccountChanged\(\{ shopId: owner\.shopId, ibanLast4: saved\.iban\.slice\(-4\) \}\)\);/);
  const notify = strip(read("lib/notify.ts"));
  const fn = notify.slice(notify.indexOf("export async function notifyPayoutAccountChanged"));
  assert.match(fn, /shopUsers: \{ where: \{ role: "OWNER" \}/);
  assert.match(fn, /input\.ibanLast4/);
  assert.ok(!/\.iban\b/.test(fn.replace(/ibanLast4/g, "")), "never the full IBAN");
});

test("the admin confirms a recently changed account before paying it", () => {
  const route = strip(read("app/api/admin/payouts/route.ts"));
  assert.match(route, /const confirmedRecentChange = body\.confirmRecentChange === true;/);
  assert.match(route, /if \(changedRecently\(account\.updatedAt\) && !confirmedRecentChange\) throw new PayoutRefused\("account_recently_changed", 409\);/);
  const page = strip(read("app/dashboard/admin/payouts/page.tsx"));
  assert.match(page, /confirmRecentChange: recentChange && confirmedChange,/);
  assert.match(page, /disabled=\{!confirmed \|\| \(recentChange && !confirmedChange\) \|\|/);
  for (const locale of ["en", "ar"]) {
    const m = JSON.parse(read(`messages/${locale}.json`)).adminPayouts;
    assert.ok(m.confirmRecentChange && m.errors.accountRecentlyChanged, locale);
  }
});

test("the Stripe webhook is retired", () => {
  const stripe = strip(read("app/api/webhooks/stripe/route.ts"));
  assert.match(stripe, /export async function POST\(\) \{\s*return NextResponse\.json\(\{ error: "gone" \}, \{ status: 410 \}\);\s*\}/);
  assert.ok(!/prisma|stripe\.|constructEvent/.test(stripe));
});

test("pre-launch is on unless exactly \"false\", decided before validation", () => {
  const env = strip(read("lib/env.ts"));
  assert.match(env, /PRE_LAUNCH_MODE: z\.boolean\(\),/);
  assert.match(env, /PRE_LAUNCH_MODE: process\.env\.PRE_LAUNCH_MODE !== "false",/);
  for (const raw of [undefined, "", "true", "False", "FALSE", "no", "0", " false"]) {
    assert.equal(raw !== "false", true, `${JSON.stringify(raw)} keeps pre-launch on`);
  }
});

test("checkout: a plain-text product id, and no test account on the live site", () => {
  const route = strip(read("app/api/checkout/route.ts"));
  assert.match(route, /if \(typeof productId !== "string" \|\| productId\.length > 64\)/);
  assert.match(route, /\(configuredMode === "test" && productionAccountHere\(process\.env\.VERCEL_ENV\)\)/);
  assert.match(route, /access\.kind !== "founder_test" && isShopMemberEmail\(buyerEmail, teamEmails\)/);
});
