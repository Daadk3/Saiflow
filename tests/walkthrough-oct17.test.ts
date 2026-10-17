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

describe("B10: the create-store address preview is right", () => {
  test("it shows SaiFlow's real domain, from the one shared constant", async () => {
    const page = read("app/dashboard/create-shop/page.tsx");
    assert.ok(page.includes('import { SITE_URL } from "@/lib/site-url";'));
    assert.ok(page.includes("host: SITE_HOST"));
    for (const messages of [en(), ar()]) {
      assert.ok(messages.dashboard.createShop.slugPreview.includes("{host}/shop/{slug}"));
      assert.ok(!messages.dashboard.createShop.slugPreview.includes("saiflow.com"));
    }
    const { SITE_URL } = await import("../lib/site-url.ts");
    assert.equal(new URL(SITE_URL).host, "www.saiflow.io");
  });

  test("the preview uses the server's slug rule, so mixed names lose their stray hyphens", async () => {
    const { slugBase } = await import("../lib/slug.ts");
    assert.equal(slugBase("SaiFlow Test Store (تجريبي)"), "saiflow-test-store");
    assert.equal(slugBase("  -Hello- "), "hello");
    assert.ok(read("app/dashboard/create-shop/page.tsx").includes("slugBase(name).length >= 2"));
  });

  test("no saiflow.com address is left anywhere a user can see", () => {
    for (const file of ["messages/en.json", "messages/ar.json", "app/docs/[slug]/page.tsx", "app/dashboard/create-shop/page.tsx"]) {
      assert.ok(!read(file).includes("saiflow.com"), file);
    }
  });
});

describe("B11: signing out takes one click", () => {
  test("the button waits for the session to end, then reloads the home page, and cannot be clicked twice", () => {
    const button = read("components/auth/SignOutButton.tsx");
    assert.ok(button.includes("await signOut({ redirect: false })"));
    assert.ok(button.includes('window.location.assign("/")'));
    assert.ok(button.includes("disabled={busy}"));
  });

  test("both navbar menus use it; nothing calls signOut with an immediate redirect any more", () => {
    const nav = read("components/Navbar.tsx");
    assert.equal((nav.match(/<SignOutButton/g) ?? []).length, 2);
    assert.ok(!nav.includes("signOut({ callbackUrl"));
    assert.ok(en().nav.signingOut && ar().nav.signingOut);
  });
});

describe("B12: \"checkout is being activated\" appears once on a product page", () => {
  test("the button says it in pre-launch; the page's own line shows only once payments are open, and says something else", () => {
    const page = read("app/shop/[slug]/product/[productSlug]/page.tsx");
    assert.match(page, /\{!preLaunchMode && \(\s*<p className="text-center text-sm text-gray-500 mt-4">\s*\{t\("storefront\.productDetail\.secureCheckout"\)\}/);
    assert.ok(read("app/shop/[slug]/product/[productSlug]/BuyButton.tsx").includes('t("preLaunch.checkoutDisabled")'));
    assert.equal(en().storefront.productDetail.secureCheckout, "Secure checkout.");
    assert.notEqual(ar().storefront.productDetail.secureCheckout, ar().preLaunch.checkoutDisabled);
  });
});
