/**
 * Long-form product page and compare-at price.
 *
 * The selling price is what checkout charges. The compare-at price is a
 * strike-through, and only when it is higher. Page sections are optional,
 * length-limited, and refused when they carry off-platform contact — the
 * same check the description already takes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Prisma } from "@prisma/client";
import {
  LANDING_LIMITS,
  hasLandingContent,
  listingFormToBody,
  landingPlainText,
  parseCompareAt,
  parseLanding,
  publicOffer,
  readLanding,
} from "@/lib/product-landing";
import { listingWrite } from "@/lib/products/listing-write";
import { computeReviewChecks, type FileContentFacts } from "@/lib/review-checklist";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const CLEAN_FACTS: FileContentFacts = {
  kind: "pdf",
  opens: true,
  pageCount: 12,
  textChecked: true,
  contact: [],
  banned: [],
};
const base = {
  name: "دفتر تخطيط أسبوعي",
  description: "ملف PDF من 12 صفحة للتخطيط الأسبوعي، جاهز للطباعة.",
  fileKey: "key_a",
  fileScanStatus: "SAFE",
  fileScanKey: "key_a",
  facts: CLEAN_FACTS,
};

const page = {
  audience: "مصممون مستقلون يريدون مخططًا جاهزًا للطباعة.",
  benefits: ["يوفر ساعة كل أحد", "جاهز للطباعة على ورق A4"],
  included: ["ملف PDF من 12 صفحة", "نسخة قابلة للتعديل"],
  faq: [{ question: "هل يعمل على الجوال؟", answer: "نعم. تفتح الملف من أي قارئ PDF." }],
  guarantee: "إن لم يناسبك الملف خلال سبعة أيام، نعيد المبلغ.",
};

describe("compare-at price", () => {
  test("a higher price is stored, and the saving is a whole percent", () => {
    const parsed = parseCompareAt("149.00", "99.00");
    assert.deepEqual(parsed, { ok: true, compareAtPrice: "149.00" });
    assert.deepEqual(publicOffer("99.00", "149.00"), { compareAt: 149, percent: 33 });
  });

  test("equal, lower, blank and invalid amounts", () => {
    assert.equal(parseCompareAt("99", "99.00").ok, false);
    assert.match((parseCompareAt("99", "99.00") as { error: string }).error, /higher than the selling price/);
    assert.equal(parseCompareAt("50", "99").ok, false);
    assert.deepEqual(parseCompareAt("", "99"), { ok: true, compareAtPrice: null });
    assert.deepEqual(parseCompareAt(null, "99"), { ok: true, compareAtPrice: null });
    assert.equal(parseCompareAt("10.005", "9").ok, false);
    assert.equal(parseCompareAt("not-money", "9").ok, false);
    assert.equal(parseCompareAt(200_000, "9").ok, false);
    assert.equal(publicOffer(99, 99), null);
    assert.equal(publicOffer(99, 50), null);
    assert.equal(publicOffer(99, null), null);
  });

  test("a gap under one percent still shows the strike and hides the badge", () => {
    const offer = publicOffer("99.50", "100.00");
    assert.equal(offer?.compareAt, 100);
    assert.equal(offer?.percent, null);
  });

  test("an omitted compare-at price is not cleared", () => {
    const written = listingWrite({ landing: null }, "40.00");
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.equal("compareAtPrice" in written.data, false);
    assert.equal(written.data.landing, Prisma.DbNull);
  });
});

describe("product page sections", () => {
  test("a full page is kept, and an empty one is stored as nothing", () => {
    const parsed = parseLanding(page);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.landing?.benefits, page.benefits);
    assert.equal(hasLandingContent(parsed.landing), true);
    assert.deepEqual(parseLanding(null), { ok: true, landing: null });
    assert.deepEqual(parseLanding({}), { ok: true, landing: null });
    assert.deepEqual(parseLanding({ benefits: ["  ", ""] }), { ok: true, landing: null });
    assert.equal(readLanding(null), null);
    assert.equal(readLanding("nope"), null);
    assert.equal(readLanding({ benefits: ["ready to print"] })?.benefits[0], "ready to print");
  });

  test("length and count limits are refused, not trimmed", () => {
    const long = "ا".repeat(LANDING_LIMITS.benefits.item + 1);
    const over = parseLanding({ benefits: [long] });
    assert.equal(over.ok, false);
    if (over.ok) return;
    assert.match(over.error, /at most 180/);
    assert.match(over.errorAr, /180/);
    const tooMany = parseLanding({ benefits: Array.from({ length: LANDING_LIMITS.benefits.max + 1 }, (_, i) => `فائدة ${i}`) });
    assert.equal(tooMany.ok, false);
    const halfFaq = parseLanding({ faq: [{ question: "سؤال كامل", answer: "" }] });
    assert.equal(halfFaq.ok, false);
    const badShape = parseLanding(["not", "an", "object"]);
    assert.equal(badShape.ok, false);
  });

  test("a phone, email, link or invitation is refused; a price and a caption are not", () => {
    for (const text of ["للطلب 0551234567", "seller@example.com", "زوروا https://example.com", "تابعني @my_store", "تواصل معنا"]) {
      const parsed = parseLanding({ benefits: [text] });
      assert.equal(parsed.ok, false, text);
      if (parsed.ok) continue;
      assert.match(parsed.error, /outside SaiFlow/);
      assert.match(parsed.errorAr, /SaiFlow/);
    }
    assert.equal(parseLanding({ audience: "Instagram caption examples for a small shop." }).ok, true);
    assert.equal(parseLanding({ included: ["السعر 49 ريال، 12 صفحة"] }).ok, true);
    // A bare platform name is not an established contact, same as the description.
    assert.equal(parseLanding({ benefits: ["تيليجرام"] }).ok, true);
  });

  test("the form turns blank lines into a clear, and keeps real lines", () => {
    const body = listingFormToBody({
      compareAtPrice: "  ",
      benefits: " واحدة \n\n ثانية ",
      included: "",
      audience: "  ",
      guarantee: "",
      faq: [{ question: "  ", answer: "  " }, { question: "متى؟", answer: "فورًا" }],
    });
    assert.equal(body.compareAtPrice, null);
    assert.deepEqual(body.landing, { benefits: ["واحدة", "ثانية"], faq: [{ question: "متى؟", answer: "فورًا" }] });
  });

  test("the review checklist scans the page the way it scans the description", () => {
    const clean = computeReviewChecks({ ...base, pageText: landingPlainText(readLanding(page)) });
    assert.equal(clean.points[6].state, "ok");
    assert.match(clean.points[6].reason, /صفحة المنتج/);
    const phone = computeReviewChecks({ ...base, pageText: "راسلنا على 0551234567" });
    assert.equal(phone.points[6].state, "warn");
    assert.match(phone.points[6].reason, /رقم هاتف.*\(صفحة المنتج\)/);
    const banned = computeReviewChecks({ ...base, pageText: "حل واجبات الرياضيات" });
    assert.equal(banned.points[7].state, "warn");
    // No page text: the reason stays the one existing products already show.
    const none = computeReviewChecks(base);
    assert.equal(none.points[6].state, "ok");
    assert.doesNotMatch(none.points[6].reason, /صفحة المنتج/);
  });
});

describe("what the buyer is charged", () => {
  test("checkout and the Stripe webhook still read product.price and never the compare-at price", () => {
    for (const file of ["app/api/checkout/route.ts", "app/api/webhooks/stripe/route.ts", "app/api/webhooks/geidea/route.ts"]) {
      const src = read(file);
      assert.ok(!src.includes("compareAtPrice"), file);
    }
    assert.match(read("app/api/checkout/route.ts"), /canonicalAmount\(product\.price\)/);
  });

  test("the migration only adds the two nullable columns", () => {
    const sql = read("prisma/migrations/20261112120000_product_landing_and_compare_at/migration.sql");
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "compareAtPrice" DECIMAL\(10,2\)/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "landing" JSONB/);
    assert.ok(!/\bNOT NULL\b/.test(sql));
    assert.ok(!/\bDEFAULT\b/.test(sql));
    assert.ok(!/\bDROP\b/.test(sql));
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /compareAtPrice\s+Decimal\?/);
    assert.match(schema, /landing\s+Json\?/);
    const dirs = readdirSync(resolve(ROOT, "prisma/migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.ok(dirs.includes("20261112120000_product_landing_and_compare_at"));
  });
});

describe("rendering", () => {
  const sections = read("components/storefront/ProductLandingSections.tsx");
  const price = read("components/storefront/ProductPrice.tsx");
  const pageSrc = read("app/shop/[slug]/product/[productSlug]/page.tsx");

  test("an empty page renders no sections", () => {
    assert.match(sections, /if \(!hasLandingContent\(landing\) \|\| !landing\) return null/);
    assert.match(pageSrc, /const showLanding = hasLandingContent\(product\.landing\)/);
    assert.match(pageSrc, /\{showLanding && \(/);
  });

  test("each section is a heading plus seller text that keeps its own direction", () => {
    for (const heading of ["labels.audience", "labels.benefits", "labels.included", "labels.faq", "labels.guarantee"]) {
      assert.ok(sections.includes(heading), heading);
    }
    assert.ok(sections.includes('dir="auto"'));
    assert.ok(sections.includes("[unicode-bidi:plaintext]"));
    assert.ok(sections.includes("landing.benefits.map"));
    assert.ok(sections.includes("landing.included.map"));
    assert.ok(sections.includes("landing.faq.map"));
    assert.ok(sections.includes("{children"));
  });

  test("the charged price stays prominent, with the compare-at price struck through", () => {
    assert.match(price, /publicOffer\(price, compareAtPrice\)/);
    assert.match(price, /<s /);
    assert.match(price, /formatPrice\(price, currency, locale\)/);
    assert.match(price, /formatPrice\(offer\.compareAt, currency, locale\)/);
    assert.match(price, /\{saveLabel\}/);
    assert.match(pageSrc, /saveLabel=\{saveLabel\}/);
    assert.match(pageSrc, /t\("storefront\.productDetail\.savePercent"/);
  });

  test("the repeated buy control uses the same checkout path, and only on a page that has sections", () => {
    const repeats = pageSrc.match(/<BuyButton checkoutHref=\{checkoutHref\} sellable preLaunchMode=\{preLaunchMode\} \/>/g) ?? [];
    assert.equal(repeats.length, 3);
    const block = pageSrc.slice(pageSrc.indexOf("{showLanding && ("));
    assert.match(block, /<BuyButton checkoutHref=\{checkoutHref\} sellable preLaunchMode=\{preLaunchMode\} \/>/);
  });

  test("both seller forms submit the fields, and both languages name them", () => {
    for (const file of [
      "app/dashboard/shop/[slug]/add-product/page.tsx",
      "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
    ]) {
      const src = read(file);
      assert.ok(src.includes("<ProductListingFields"), file);
      assert.ok(src.includes("...listingFormToBody(listing)"), file);
    }
    const en = JSON.parse(read("messages/en.json"));
    const ar = JSON.parse(read("messages/ar.json"));
    for (const key of ["compareAtLabel", "landingHeading", "benefitsLabel", "includedLabel", "faqLabel", "guaranteeLabel", "audienceLabel"]) {
      assert.ok(en.dashboard.product[key], key);
      assert.ok(ar.dashboard.product[key], key);
      assert.match(ar.dashboard.product[key], /[؀-ۿ]/);
    }
    for (const key of ["savePercent", "benefitsHeading", "insideHeading", "faqHeading", "guaranteeHeading", "audienceHeading"]) {
      assert.ok(en.storefront.productDetail[key], key);
      assert.match(ar.storefront.productDetail[key], /[؀-ۿ]/);
    }
  });
});
