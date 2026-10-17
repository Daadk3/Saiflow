/**
 * A product's admin page can always change its moderation decision.
 *
 * Found on the live site: an approved product turned out to be a logo sold as
 * a website template, and nothing on its page could reject it. The server
 * route always accepted the change; the page offered no control once a
 * product had been decided.
 *
 * Structural: reads the source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const buttons = strip(read("components/admin/DecisionButtons.tsx"));
const page = strip(read("app/dashboard/admin/products/[id]/preview/page.tsx"));
const route = strip(read("app/api/admin/moderation/[productId]/route.ts"));

test("the page renders the controls for every status, not only for undecided products", () => {
  assert.match(page, /import DecisionButtons from "@\/components\/admin\/DecisionButtons";/);
  const use = /<DecisionButtons\s+productId=\{product\.id\}\s+status=\{product\.moderationStatus\}/.exec(page);
  assert.ok(use, "rendered with the product's current status");
  const before = page.slice(Math.max(0, use!.index - 300), use!.index);
  assert.ok(!/(humanReviewed|moderationStatus === "PENDING") && \(\s*$/.test(before), "not gated on being undecided");
});

test("only decisions that change something are offered", () => {
  assert.match(buttons, /\{status !== "APPROVED" && \(\s*<button[\s\S]*?decide\("APPROVED"\)/);
  assert.match(buttons, /\{status !== "REJECTED" && \(\s*<button[\s\S]*?decide\("REJECTED"\)/);
});

test("it goes through the one audited route, and a rejection needs a reason", () => {
  assert.match(buttons, /fetch\(`\/api\/admin\/moderation\/\$\{productId\}`/);
  assert.match(buttons, /if \(!reason\?\.trim\(\)\) return;/);
  // The route records the change against the status it replaced, needs a reason to reject, and tells the seller.
  assert.match(route, /previousStatus: product\.moderationStatus/);
  assert.match(route, /action === "REJECTED" && \(!reason/);
  assert.match(route, /notifyProductModerated\(/);
  assert.ok(!/moderationStatus: "PENDING"|where: \{[^}]*moderationStatus/.test(route.slice(route.indexOf("export async function POST"))), "no rule limits it to undecided products");
});

test("the page still sells nothing", () => {
  assert.ok(!/BuyButton|\/api\/checkout/.test(page + buttons));
});
