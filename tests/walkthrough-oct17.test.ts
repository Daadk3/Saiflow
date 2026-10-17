/**
 * Fixes from the 17 October 2026 live walkthrough.
 *
 * Mostly structural: these are rendering and wording fixes on pages that
 * need a database or a browser to run, so the tests pin the source that
 * decides each behaviour. Each section names the walkthrough item it covers.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const en = () => JSON.parse(read("messages/en.json"));
const ar = () => JSON.parse(read("messages/ar.json"));

describe("B7: the store's cover shows on its public page", () => {
  test("rendered above the header, 3:1, when the store has one", () => {
    const page = read("app/shop/[slug]/page.tsx");
    const cover = page.indexOf("{shop.coverImage && (");
    const header = page.indexOf("{/* Shop header */}");
    assert.ok(cover > 0 && header > cover, "cover first, then the header");
    assert.ok(page.includes("src={shop.coverImage}"));
    assert.ok(page.includes("aspect-[3/1]"));
  });
});

describe("B9: no link goes nowhere", () => {
  test("no href=\"#\" anywhere in pages or components", () => {
    for (const file of ["app/signup/page.tsx", "app/dashboard/shop/[slug]/add-product/page.tsx"]) {
      assert.ok(!read(file).includes('href="#"'), file);
    }
  });

  test("signup's Terms and Privacy open the real pages; the add-product help opens the listing standards", () => {
    const signup = read("app/signup/page.tsx");
    assert.ok(signup.includes('<Link href="/terms"') && signup.includes('<Link href="/privacy"'));
    assert.ok(read("app/dashboard/shop/[slug]/add-product/page.tsx").includes('<Link href="/content-policy#listing-standards"'));
    assert.ok(read("app/content-policy/page.tsx").includes('<section id="listing-standards"'));
    assert.match(en().dashboard.product.add.helpText, /<link>listing standards<\/link>/);
    assert.match(ar().dashboard.product.add.helpText, /<link>معايير قبول المنتج<\/link>/);
  });
});
