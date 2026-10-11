/**
 * One list of listing standards, shown wherever a listing is judged.
 *
 * Structural: reads the source. The list itself is imported and checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LISTING_STANDARDS } from "../lib/listing-standards.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("every standard exists in Arabic and English", () => {
  assert.equal(LISTING_STANDARDS.length, 5);
  for (const item of LISTING_STANDARDS) {
    assert.match(item.ar, /[؀-ۿ]/, item.en);
    assert.ok(item.en.length > 10 && !/[؀-ۿ]/.test(item.en), item.en);
  }
  const en = LISTING_STANDARDS.map((s) => s.en).join(" ");
  assert.match(en, /matches the title and description/);
  assert.match(en, /preview image of the actual content, not just a logo/);
});

test("the policy, both seller forms and the review page all render the same list", () => {
  assert.match(read("app/content-policy/page.tsx"), /LISTING_STANDARDS\.map/);
  for (const [file, variant] of [
    ["app/dashboard/shop/[slug]/add-product/page.tsx", "seller"],
    ["app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx", "seller"],
    ["app/dashboard/admin/products/[id]/preview/page.tsx", "admin"],
  ] as const) {
    const src = read(file);
    assert.match(src, /import \{ ListingStandards \} from "@\/components\/ListingStandards";/, file);
    assert.match(src, new RegExp(`<ListingStandards ar=\\{locale\\.startsWith\\("ar"\\)\\} variant="${variant}" \\/>`), file);
  }
  assert.match(read("components/ListingStandards.tsx"), /LISTING_STANDARDS\.map/);
});

test("on the add form the standards come before the certification the seller ticks", () => {
  const src = read("app/dashboard/shop/[slug]/add-product/page.tsx");
  assert.ok(src.indexOf("<ListingStandards") < src.indexOf("Seller certification"));
});

test("the policy ties a missed standard to rejection, resubmission and the refund policy", () => {
  const src = read("app/content-policy/page.tsx");
  assert.match(src, /href="\/refunds"/);
  assert.match(src, /send them back for review/);
  assert.match(src, /Last updated: October 2026/);
});
