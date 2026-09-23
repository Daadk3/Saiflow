/**
 * The browse marketplace. The page was relaid out; the rules that decide
 * what can be listed were not. These checks pin both halves: the gate and
 * the filters stay what they were, search only narrows within them, and the
 * cards link to the real product route.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const page = read("app/browse/page.tsx");
const code = strip(page);
const card = strip(read("components/ProductCard.tsx"));
const thumbnail = strip(read("components/ProductThumbnail.tsx"));
const ar = JSON.parse(read("messages/ar.json")) as Record<string, Record<string, Record<string, string>>>;
const en = JSON.parse(read("messages/en.json")) as Record<string, Record<string, Record<string, string>>>;

describe("visibility: the gate and the filters are unchanged", () => {
  test("the query keeps every gate and spreads the canonical safety clause", () => {
    assert.ok(/isActive:\s*true/.test(code));
    assert.ok(/moderationStatus:\s*"APPROVED"/.test(code));
    assert.ok(/\.\.\.SAFE_DELIVERABLE_WHERE/.test(code));
    assert.ok(/from "@\/lib\/file-safety"/.test(code));
    assert.ok(!/fileScanStatus|fileScanKey|fileKey/.test(code), "no hand-rolled safety condition");
    assert.ok(/export const dynamic = "force-dynamic"/.test(code));
  });

  test("category and price filters keep their semantics", () => {
    assert.ok(/if \(isProductCategory\(category\)\) \{\s*where\.category = category;/.test(code));
    assert.ok(/where\.price\.gte = minPrice/.test(code) && /where\.price\.lte = maxPrice/.test(code));
    assert.ok(/sort === "price-asc"[\s\S]*price: "asc"[\s\S]*sort === "price-desc"[\s\S]*price: "desc"[\s\S]*createdAt: "desc"/.test(code));
  });

  test("search only narrows within the gated set, on name and description", () => {
    const or = code.match(/where\.OR = \[([\s\S]*?)\];/);
    assert.ok(or, "search is expressed as where.OR");
    assert.ok(/name: \{ contains: q, mode: "insensitive" \}/.test(or![1]));
    assert.ok(/description: \{ contains: q, mode: "insensitive" \}/.test(or![1]));
    assert.ok(!/isActive|moderationStatus|SAFE_DELIVERABLE|fileKey/.test(or![1]), "the OR never touches a gate");
    assert.ok(/MAX_QUERY_LENGTH = 80/.test(code));
    assert.ok(/raw\?\.trim\(\)\.slice\(0, MAX_QUERY_LENGTH\)/.test(code));
  });

  test("malformed prices and sorts are ignored rather than passed to the database", () => {
    assert.ok(/Number\.isFinite\(value\) && value >= 0 \? value : undefined/.test(code));
    assert.ok(/SORT_OPTIONS as readonly string\[\]\)\.includes/.test(code));
  });

  test("no popularity sort is offered while no popularity data exists", () => {
    assert.ok(/SORT_OPTIONS = \["newest", "price-asc", "price-desc"\] as const/.test(code));
    assert.ok(!/popular/i.test(code), "nothing on the page mentions popularity");
    for (const m of [ar, en]) assert.ok(!("sortPopular" in m.storefront.browse));
  });

  test("the deliverable and the inspection routes stay off the page", () => {
    assert.ok(!/fileUrl/.test(code), "the paid asset URL is never selected or rendered");
    assert.ok(!page.includes("/api/admin"), "no admin route");
    assert.ok(!page.includes("getProductsDirectory"));
  });
});

describe("marketplace layout", () => {
  test("the shared product card is the only product link", () => {
    assert.ok(/from "@\/components\/ProductCard"/.test(code));
    assert.ok(/<ProductCard/.test(code));
    assert.ok(!/href=\{`\/shop/.test(code), "the card owns the product link");
    assert.ok(card.includes("href={`/shop/${product.shop.slug}/product/${product.slug}`}"));
  });

  test("the grid is one column on phones, three on laptops and four only on very wide screens", () => {
    assert.ok(/grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 2xl:grid-cols-4/.test(code));
  });

  test("the header is compact: no eyebrow, and search is one pill with the submit inside it", () => {
    assert.ok(!/storefront\.browse\.eyebrow/.test(code));
    const form = code.match(/<form method="get" action="\/browse" role="search"[\s\S]*?<\/form>/)![0];
    const pill = form.indexOf("focus-within:border-teal-500");
    const input = form.indexOf('name="q"');
    const button = form.indexOf('type="submit"');
    const close = form.indexOf("</div>", button);
    assert.ok(pill !== -1 && pill < input && input < button && button < close, "icon, field and submit share one container");
    assert.ok(!/btn-primary/.test(form), "no detached glowing button");
  });

  test("sorting is a compact disclosure reading 'sort: current', with the options as links", () => {
    const sortBlock = code.match(/<details className="relative">\s*<summary[\s\S]*?sortLabel[\s\S]*?<\/details>/)![0];
    assert.ok(/sortLabels\[sort\]/.test(sortBlock), "the trigger names the current sort");
    assert.ok(/SORT_OPTIONS\.map/.test(sortBlock) && /browseHref\(filters, \{ sort: option \}\)/.test(sortBlock));
    assert.ok(/<details className="relative">[\s\S]*?priceLabel/.test(code), "price is a disclosure too");
  });

  test("search is a visible GET form that keeps the other filters", () => {
    assert.ok(/<form method="get" action="\/browse" role="search"/.test(code));
    assert.ok(/name="q"/.test(code) && /type="search"/.test(code));
    assert.ok(/hiddenFilters\("q"\)/.test(code), "the search form carries category, sort and price along");
  });

  test("category chips, sort links and the price form all derive from one URL builder", () => {
    assert.ok(/browseHref\(filters, \{ category: undefined \}\)/.test(code));
    assert.ok(/browseHref\(filters, \{ category: slug \}\)/.test(code));
    assert.ok(/browseHref\(filters, \{ sort: option \}\)/.test(code));
    assert.ok(/name="minPrice"/.test(code) && /name="maxPrice"/.test(code));
    assert.ok(/hiddenFilters\("price"\)/.test(code));
  });

  test("the URL builder round-trips every filter and drops defaults", () => {
    const fn = code.match(/function browseHref[\s\S]*?\n\}/)![0];
    for (const key of ["category", "q", "sort", "minPrice", "maxPrice"]) {
      assert.ok(fn.includes(`params.set("${key}"`), key);
    }
    assert.ok(/next\.sort !== "newest"/.test(fn));
    assert.ok(/return query \? `\/browse\?\$\{query\}` : "\/browse";/.test(fn));
  });

  test("the card keeps a fixed 4:3 frame, a two-line title and one link", () => {
    assert.ok(/aspect-\[4\/3\]/.test(card));
    assert.ok(/line-clamp-2 min-h-\[2\.75rem\]/.test(card), "titles clamp to two lines at a fixed height");
    assert.ok(/<ProductThumbnail/.test(card));
    assert.equal((card.match(/<Link/g) ?? []).length, 1);
  });

  test("a missing or broken thumbnail renders a category icon tile, never a blank frame or broken image", () => {
    for (const [slug, icon] of [["ebooks", "IconBook"], ["courses", "IconPlay"], ["templates", "IconTemplate"], ["art", "IconPalette"], ["music", "IconMusic"], ["software", "IconCode"]]) {
      assert.ok(new RegExp(`${slug}: \\{ Icon: ${icon},`).test(card), `${slug} falls back to ${icon}`);
    }
    assert.ok(/match\?\.Icon \?\? IconImage/.test(card), "an unknown category still gets a neutral icon");
    assert.ok(/^"use client";/.test(thumbnail.trim()));
    assert.ok(/onError=\{\(\) => setFailed\(true\)\}/.test(thumbnail));
    assert.ok(/if \(!src \|\| failed\) return <>\{fallback\}<\/>;/.test(thumbnail));
    assert.ok(/object-contain object-center/.test(thumbnail), "real artwork is contained and centred, never cropped");
    assert.ok(!/object-cover/.test(thumbnail));
    assert.ok(/absolute inset-0 bg-gradient-to-br from-gray-800\/50/.test(thumbnail), "a tinted backdrop fills the unused frame");
    for (const src of [card, thumbnail, code]) assert.ok(!/placeholder\.png/.test(src));
  });

  test("the empty state is copy with real routes, and nothing pretends to be a product", () => {
    assert.ok(/products\.length > 0 \?/.test(code));
    assert.ok(/emptyTitle|emptyFilteredTitle/.test(code));
    assert.ok(/href="\/signup"/.test(code));
    assert.ok(!/Math\.random|placeholder\.png|demo|sample/i.test(code), "no demo products");
    assert.ok(!/comingSoonBadge/.test(code));
  });

  test("browse copy exists in both locales with identical keys", () => {
    assert.deepEqual(Object.keys(ar.storefront.browse).sort(), Object.keys(en.storefront.browse).sort());
    assert.equal(ar.storefront.browse.sortLabel, "ترتيب");
    for (const key of ["title", "subtitle", "searchPlaceholder", "searchButton", "sortLabel", "priceLabel", "byShop", "emptyTitle", "emptyFilteredTitle", "emptyCta"]) {
      assert.ok(ar.storefront.browse[key]?.length > 0, `ar ${key}`);
      assert.ok(en.storefront.browse[key]?.length > 0, `en ${key}`);
    }
    assert.equal(ar.storefront.browse.title, "اكتشف منتجات رقمية");
  });
});
