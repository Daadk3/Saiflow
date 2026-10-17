/**
 * The checkout page says "Test mode, no real charge" whenever Geidea is not
 * live.
 *
 * What must hold:
 * - "Live" means fully configured AND GEIDEA_ENV "production"; a test
 *   account, a missing variable or no mode is not live (lib/payments/checkout-mode).
 * - The page shows the banner above the product whenever the card form is
 *   offered and checkout is not live; while payments are off, the existing
 *   "not available yet" notice stands instead.
 * - The banner only adds words: the checkout route's own gates are untouched.
 *
 * Behavioural for the rule; structural (reads the source) for the page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isLiveCheckout } from "../lib/payments/checkout-mode.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("live only when configured and in production mode", () => {
  assert.equal(isLiveCheckout(true, "production"), true);
  for (const [configured, mode] of [
    [true, "test"],
    [true, null],
    [false, "production"],
    [false, "test"],
    [false, null],
  ] as const) {
    assert.equal(isLiveCheckout(configured, mode), false, `${configured} ${mode}`);
  }
});

const page = strip(read("app/checkout/[slug]/[productSlug]/page.tsx"));

test("the page decides from the deployment's own Geidea configuration", () => {
  assert.match(page, /const testMode = !env\.PRE_LAUNCH_MODE && !isLiveCheckout\(isGeideaConfigured\(\), geideaMode\(\)\);/);
});

test("the banner sits right under the title, before the product and the card form", () => {
  const banner = page.indexOf("{testMode && (");
  assert.ok(banner > page.indexOf("{t(\"title\")}</h1>"), "after the title");
  assert.ok(banner < page.indexOf("<CheckoutSummary"), "before the product summary");
  assert.ok(banner < page.indexOf("<DropInCheckout"), "before the card form");
  const block = page.slice(banner, page.indexOf("</div>", banner));
  assert.match(block, /role="note"/);
  assert.match(block, /t\("testModeTitle"\)/);
  assert.match(block, /t\("testModeBody"\)/);
});

test("reading the mode only reads configuration: no request, no database", () => {
  const client = strip(read("lib/payments/geidea/client.ts"));
  assert.match(client, /export function geideaMode\(\): "test" \| "production" \| null \{\s*return env\.GEIDEA_ENV \?\? null;\s*\}/);
  assert.match(client, /export function isGeideaConfigured\(\): boolean \{\s*return REQUIRED_VARS\.every\(isSet\);\s*\}/);
});

test("every mode the route can charge in gets the banner", () => {
  // While LIVE_GEIDEA_ALLOWED is false (pinned below) the route charges only
  // in "test" mode, and a configured "test" mode is never live.
  assert.equal(isLiveCheckout(true, "test"), false);
});

test("the checkout route's gates are unchanged", () => {
  const route = strip(read("app/api/checkout/route.ts"));
  assert.match(route, /const LIVE_GEIDEA_ALLOWED = false;/);
  assert.match(route, /if \(!LIVE_GEIDEA_ALLOWED && configuredMode !== "test"\)/);
  assert.ok(!route.includes("checkout-mode"), "the route does not take its rule from the banner");
});

test("the banner's words exist in both languages and say no real charge", () => {
  const en = JSON.parse(read("messages/en.json")).checkout;
  const ar = JSON.parse(read("messages/ar.json")).checkout;
  assert.equal(en.testModeTitle, "Test mode, no real charge");
  assert.match(en.testModeBody, /no card is charged/);
  assert.ok(ar.testModeTitle.includes("الاختبار") && ar.testModeBody.includes("لا يُخصم"));
});
