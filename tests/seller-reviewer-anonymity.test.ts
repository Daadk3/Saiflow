/**
 * Sellers never see which admin decided (27 Oct 2026).
 *
 * A seller is told what was decided, why and when, signed by the team:
 * "فريق SaiFlow". The admin's own name or address stays in the audit log
 * (ModerationEvent.actor) and on the admin pages, for internal records.
 *
 * What must hold:
 * - The seller-facing APIs read the reason and date of a rejection, never
 *   its actor, and never look up a user to name one.
 * - The seller's dashboard and edit page show the team and the date.
 * - Approval and rejection emails are signed by the team.
 * - The admin review page still names the admin.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SELLER_APIS = ["app/api/shops/[slug]/route.ts", "app/api/products/[id]/route.ts"];
const SELLER_PAGES = [
  "app/dashboard/shop/[slug]/page.tsx",
  "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
];

describe("seller-facing APIs", () => {
  for (const path of SELLER_APIS) {
    test(`${path} sends the rejection's reason and date, not who decided`, () => {
      const src = read(path);
      assert.match(src, /select: \{ reason: true, createdAt: true \}/);
      assert.match(src, /rejectedAt:/);
      assert.doesNotMatch(src, /actor: true/);
      assert.doesNotMatch(src, /moderation-history/);
    });
  }
});

describe("seller pages", () => {
  for (const path of SELLER_PAGES) {
    test(`${path} signs the rejection box with the team and the date`, () => {
      const src = read(path);
      assert.match(src, /tModeration\("decidedBy", \{ date: formatDate\(product\.rejectedAt, locale\) \}\)/);
      assert.doesNotMatch(src, /byName|whoDecided/);
    });
  }

  test("the team, not a person, in both languages", () => {
    const ar = JSON.parse(read("messages/ar.json"));
    const en = JSON.parse(read("messages/en.json"));
    assert.equal(ar.moderation.decidedBy, "فريق SaiFlow، {date}");
    assert.equal(en.moderation.decidedBy, "The SaiFlow team, {date}");
  });
});

describe("moderation emails", () => {
  test("approval and rejection are both signed by the team", () => {
    const src = read("lib/notify.ts");
    assert.match(src, /MODERATION_SIGNOFF: BilingualLine = \{ ar: "فريق SaiFlow", en: "The SaiFlow team" \}/);
    const body = src.slice(src.indexOf("export async function notifyProductModerated"));
    const end = body.indexOf("\n}\n");
    assert.equal(body.slice(0, end).match(/MODERATION_SIGNOFF,/g)?.length, 2);
  });
});

describe("admin pages keep the real name", () => {
  test("the review page still says who decided", () => {
    assert.match(read("app/dashboard/admin/products/[id]/preview/page.tsx"), /whoDecided\(rejection, t\)/);
  });
});
