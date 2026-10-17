/**
 * Moderation truthfulness (17 Oct 2026, prompt 5).
 *
 * What must hold:
 * - The review checklist shows ✓ only for what the server verified, ✗ for
 *   what failed (missing file, no preview, short description) and a neutral
 *   mark for what only a person can judge. Sellers see no ticks at all.
 * - The Founder Dashboard's attention list and the directory's
 *   "Approved, not sellable" filter are the same rule; "Needs review" is a
 *   different question (no human decision yet).
 * - Every public page that lists products filters with the shared rule.
 * - Every writer of moderationStatus "APPROVED" goes through the safe-file
 *   condition.
 * - No text claims an unsellable product is listed or on sale.
 */
import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let preview: typeof import("../lib/admin-product-preview.ts");
let standards: typeof import("../lib/listing-standards.ts");

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: { product: { fields: { fileKey: { _toFieldRef: "Product.fileKey" } } } } } });
  mock.module("@/lib/notify", { namedExports: { notifyAdminsProductReadyForReview: async () => [] } });
  preview = await import("../lib/admin-product-preview.ts");
  standards = await import("../lib/listing-standards.ts");
});

const good = {
  fileKey: "k1",
  fileScanStatus: "SAFE",
  fileScanKey: "k1",
  thumbnailUrl: "https://app1.ufs.sh/f/thumb0001",
  images: [] as string[],
  description: "x".repeat(200),
};
const stateOf = (checks: { key: string; state: string }[], key: string) => checks.find((c) => c.key === key)?.state;

describe("the review checklist tells the truth", () => {
  test("a complete product: the three automatic checks pass, every standard stays manual", () => {
    const checks = preview.listingChecks(good);
    assert.deepEqual(checks.slice(0, 3).map((c) => [c.key, c.state]), [
      ["file_safe", "pass"],
      ["preview_image", "pass"],
      ["description_length", "pass"],
    ]);
    const manual = checks.slice(3);
    assert.equal(manual.length, standards.LISTING_STANDARDS.length);
    assert.ok(manual.every((c) => c.state === "manual"), "no standard is ever ticked automatically");
  });

  test("a missing or unsafe file, no preview, or a short description fails", () => {
    for (const file of [
      { fileKey: null, fileScanKey: null },
      { fileScanStatus: "PENDING_SCAN", fileScanKey: null },
      { fileScanStatus: "UNSAFE" },
      { fileScanKey: "older" },
    ]) {
      assert.equal(stateOf(preview.listingChecks({ ...good, ...file }), "file_safe"), "fail", JSON.stringify(file));
    }
    assert.equal(stateOf(preview.listingChecks({ ...good, thumbnailUrl: null }), "preview_image"), "fail");
    assert.equal(stateOf(preview.listingChecks({ ...good, thumbnailUrl: null, images: ["https://app1.ufs.sh/f/img00001"] }), "preview_image"), "pass");
    const short = "x".repeat(standards.MIN_DESCRIPTION_LENGTH - 1);
    assert.equal(stateOf(preview.listingChecks({ ...good, description: `   ${short}   ` }), "description_length"), "fail", "trimmed");
    assert.equal(stateOf(preview.listingChecks({ ...good, description: null }), "description_length"), "fail");
    assert.equal(stateOf(preview.listingChecks({ ...good, description: "x".repeat(standards.MIN_DESCRIPTION_LENGTH) }), "description_length"), "pass");
  });

  test("the component draws ✓ only for pass, ✗ for fail, ○ for manual; sellers get bullets, no ticks", () => {
    const src = read("components/ListingStandards.tsx");
    assert.ok(src.includes('state === "pass"\n      ? ["✓"'), "✓ belongs to pass only");
    assert.ok(src.includes('["✗", "text-red-400"'));
    assert.ok(src.includes('["○", "text-gray-500"'));
    const seller = src.slice(src.indexOf('variant === "seller" ? ('), src.indexOf(") : (", src.indexOf('variant === "seller" ? (')));
    assert.ok(!seller.includes("✓") && seller.includes("list-disc"), "the seller list has bullets, no ticks");
    assert.equal((strip(src).match(/✓/g) ?? []).length, 1, "outside comments, ✓ appears once: the pass mark");
    for (const said of ["Verified", "Not met", "Check manually", "تم التحقق", "غير مستوفى", "تحقّق يدويًا"]) {
      assert.ok(src.includes(said), said);
    }
  });
});

describe("one rule for 'approved, not sellable'", () => {
  test("the dashboard list and the directory filter use APPROVED_NOT_SELLABLE_WHERE; Needs review stays separate", () => {
    const stats = strip(read("lib/admin-stats.ts"));
    assert.ok(stats.includes("where: APPROVED_NOT_SELLABLE_WHERE,"), "dashboard list");
    assert.ok(stats.includes("prisma.product.count({ where: APPROVED_NOT_SELLABLE_WHERE })"), "dashboard count");
    assert.match(stats, /case "no_safe_file":\s*return APPROVED_NOT_SELLABLE_WHERE;/);
    assert.match(stats, /case "needs_review":\s*return \{ moderationStatus: "APPROVED", \.\.\.NEVER_ADMIN_DECIDED \};/);
    assert.ok(!/fileKey: null, isActive: true, moderationStatus: "APPROVED"/.test(stats), "the old fileKey-only list is gone");
    const page = read("app/dashboard/admin/page.tsx");
    assert.ok(page.includes('notSellable: "/dashboard/admin/products?filter=no_safe_file"'), "the mission opens the filter, not All");
  });

  test("an approved, admin-decided, fileless product is in the attention rule and not in Needs review", () => {
    // Evaluated as the database would: the attention rule's OR includes the
    // fileless case, while Needs review requires that no admin ever decided.
    const product = { isActive: true, moderationStatus: "APPROVED", shop: { isActive: true }, fileKey: null, fileScanStatus: "PENDING_SCAN", fileScanKey: null, adminDecided: true };
    const inAttention = product.isActive && product.moderationStatus === "APPROVED" && product.shop.isActive && (product.fileKey === null || product.fileScanStatus !== "SAFE");
    const inNeedsReview = product.moderationStatus === "APPROVED" && !product.adminDecided;
    assert.equal(inAttention, true);
    assert.equal(inNeedsReview, false);
    const where = read("lib/sellable.ts");
    assert.ok(where.includes("{ fileKey: null },"), "the attention rule covers the fileless case");
  });
});

describe("every public page lists only what is sellable", () => {
  const PUBLIC = ["app/page.tsx", "app/browse/page.tsx", "app/shop/[slug]/page.tsx", "app/shop/[slug]/product/[productSlug]/page.tsx", "app/checkout/[slug]/[productSlug]/page.tsx", "app/sitemap.ts"];

  test("each applies SELLABLE_PRODUCT_WHERE in its query (not merely imports it) and writes no moderation condition of its own", () => {
    const USE: Record<string, RegExp> = {
      "app/page.tsx": /where: SELLABLE_PRODUCT_WHERE,/,
      "app/browse/page.tsx": /const where: Prisma\.ProductWhereInput = \{ \.\.\.SELLABLE_PRODUCT_WHERE \};/,
      "app/shop/[slug]/page.tsx": /products: \{\s*where: SELLABLE_PRODUCT_WHERE,/,
      "app/shop/[slug]/product/[productSlug]/page.tsx": /\.\.\.SELLABLE_PRODUCT_WHERE,\s*shop: \{ \.\.\.SELLABLE_SHOP_WHERE, slug: shopSlug \}/,
      "app/checkout/[slug]/[productSlug]/page.tsx": /\.\.\.SELLABLE_PRODUCT_WHERE,\s*shop: \{ \.\.\.SELLABLE_SHOP_WHERE, slug: shopSlug \}/,
      "app/sitemap.ts": /products: \{\s*where: SELLABLE_PRODUCT_WHERE,/,
    };
    for (const file of PUBLIC) {
      const code = strip(read(file));
      assert.match(code, USE[file], `${file} must apply the shared rule in its product query`);
      assert.ok(!/moderationStatus:\s*["'{]/.test(code), `${file} restates the rule`);
    }
    assert.match(strip(read("lib/admin-stores.ts")), /shopId: \{ in: shops\.map\(\(shop\) => shop\.id\) \},\s*\.\.\.SELLABLE_PRODUCT_WHERE,/);
  });

  test("no other public page queries products by moderation status on its own", () => {
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (!["api", "dashboard"].includes(name)) walk(full);
        } else if (/\.(tsx?|ts)$/.test(name)) pages.push(relative(ROOT, full));
      }
    };
    walk(resolve(ROOT, "app"));
    for (const file of pages) {
      const code = strip(read(file));
      if (/moderationStatus: "APPROVED"/.test(code)) {
        assert.ok(code.includes("SELLABLE_PRODUCT_WHERE"), `${file} filters on APPROVED without the shared rule`);
      }
    }
  });
});

describe("every way to approve goes through the safe-file condition", () => {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mts|ts|mjs|js)$/.test(name)) sources.push(relative(ROOT, full));
    }
  };
  for (const dir of ["app", "lib", "components", "scripts"]) walk(resolve(ROOT, dir));

  test("no write sets APPROVED without SAFE_DELIVERABLE_WHERE in its own condition", () => {
    const writes: string[] = [];
    for (const file of sources) {
      const code = strip(read(file));
      for (const m of code.matchAll(/(?:data|create|update):\s*\{[^}]*?moderationStatus:\s*([^,}\s]+)/g)) {
        const value = m[1];
        writes.push(`${file}: ${value}`);
        if (value === '"PENDING"' || value === '"REJECTED"') continue;
        if (value === '"APPROVED"') {
          const call = code.slice(Math.max(0, m.index! - 200), m.index!);
          assert.ok(call.includes("...SAFE_DELIVERABLE_WHERE"), `${file} approves without the safe-file condition`);
          continue;
        }
        // A status taken from a variable may never be APPROVED: the one such
        // write is the moderation route's rejection branch, which only runs
        // when the action is not APPROVED.
        assert.equal(file, "app/api/admin/moderation/[productId]/route.ts", `${file} writes a status from a variable (${value})`);
        assert.equal(value, "action");
        const before = code.slice(0, m.index!);
        assert.ok(/if \(action === "APPROVED"\) \{[\s\S]*\} else \{\s*p = await tx\.product\.update\(\{\s*where: \{ id: productId \},\s*$/.test(before), "the variable write is the non-approval branch");
      }
    }
    assert.ok(writes.some((w) => w.endsWith('"APPROVED"')), "the gated approval write is found");
  });

  test("the queue, the directory and the review page all approve through that one route", () => {
    for (const file of ["components/admin/ReviewButton.tsx", "components/admin/DecisionButtons.tsx", "app/dashboard/moderation/page.tsx"]) {
      assert.ok(read(file).includes("/api/admin/moderation/${"), file);
    }
  });
});

describe("the words", () => {
  const en = JSON.parse(read("messages/en.json"));
  const ar = JSON.parse(read("messages/ar.json"));
  const keys = (node: unknown, prefix = ""): string[] =>
    typeof node === "string" ? [prefix] : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keys(v, `${prefix}.${k}`));

  test("English and Arabic have the same keys for every new or changed group", () => {
    for (const group of ["notSellable", "attention", "mission"]) {
      assert.deepEqual(keys(en.admin[group]).sort(), keys(ar.admin[group]).sort(), group);
    }
    assert.ok(en.admin.directory.filters.no_safe_file && ar.admin.directory.filters.no_safe_file);
    for (const reason of ["missing_file_key", "pending_scan", "scan_key_mismatch", "scan_error", "unsafe", "inactive", "shop_inactive"]) {
      assert.ok(en.admin.attention.reason[reason] && ar.admin.attention.reason[reason], reason);
      assert.ok(en.admin.notSellable.short[reason] && ar.admin.notSellable.short[reason], reason);
    }
  });

  test("nothing says an unsellable product is listed for sale", () => {
    for (const file of ["messages/en.json", "messages/ar.json"]) {
      assert.ok(!/listed for sale|the buyer receives nothing/i.test(read(file)), file);
    }
    assert.equal(en.admin.attention.eyebrow, "Approved, not sellable");
    assert.match(en.admin.attention.reason.missing_file_key, /Buyers can't see or buy it/);
  });
});
