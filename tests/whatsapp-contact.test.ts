/**
 * The public header's WhatsApp button is platform chrome.
 *
 * Sellers may not put a phone number, a wa.me link, or an off-platform
 * invitation in a listing. This suite checks that the site button lives in
 * one config and the header, and that the review pipeline still flags those
 * same strings when they are seller text — the title, the description, the
 * long-form page, and the uploaded file — never the header.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";

import { computeReviewChecks, findContactInfo, type FileContentFacts } from "@/lib/review-checklist";
import { refreshReviewChecks } from "@/lib/review-checks-store";
import {
  WHATSAPP_E164_DEFAULT,
  WHATSAPP_PREFILL_DEFAULT,
  whatsAppContactHref,
  whatsAppE164,
  whatsAppPrefill,
} from "@/lib/site-contact";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const PHONE = "966552319350";
const PREFILL = "مرحبا، عندي سؤال عن SaiFlow";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(relative(ROOT, abs).split(sep).join("/"));
  }
  return out;
}

const CLEAN_FACTS: FileContentFacts = {
  kind: "pdf",
  opens: true,
  pageCount: 12,
  textChecked: true,
  contact: [],
  banned: [],
};

const cleanListing = {
  name: "دفتر تخطيط أسبوعي",
  description: "ملف PDF من 12 صفحة للتخطيط الأسبوعي، جاهز للطباعة والاستخدام الشخصي.",
  fileKey: "key_a",
  fileScanStatus: "SAFE",
  fileScanKey: "key_a",
  facts: CLEAN_FACTS,
};

describe("the WhatsApp link has one default", () => {
  test("the default is NovaSphere's number, and only a usable env value replaces it", () => {
    const savedNumber = process.env.NEXT_PUBLIC_WHATSAPP_E164;
    const savedPrefill = process.env.NEXT_PUBLIC_WHATSAPP_PREFILL;
    try {
      delete process.env.NEXT_PUBLIC_WHATSAPP_E164;
      delete process.env.NEXT_PUBLIC_WHATSAPP_PREFILL;
      assert.equal(WHATSAPP_E164_DEFAULT, PHONE);
      assert.equal(WHATSAPP_PREFILL_DEFAULT, PREFILL);
      assert.equal(whatsAppE164(), PHONE);
      assert.equal(whatsAppPrefill(), PREFILL);
      assert.equal(
        whatsAppContactHref(),
        `https://wa.me/${PHONE}?text=${encodeURIComponent(PREFILL)}`
      );

      process.env.NEXT_PUBLIC_WHATSAPP_E164 = "+966 500 000 000";
      process.env.NEXT_PUBLIC_WHATSAPP_PREFILL = "Hello & welcome?";
      assert.equal(whatsAppE164(), "966500000000");
      assert.equal(
        whatsAppContactHref(),
        `https://wa.me/966500000000?text=${encodeURIComponent("Hello & welcome?")}`
      );

      process.env.NEXT_PUBLIC_WHATSAPP_E164 = "123";
      process.env.NEXT_PUBLIC_WHATSAPP_PREFILL = " ";
      assert.equal(whatsAppE164(), PHONE);
      assert.equal(whatsAppPrefill(), PREFILL);
    } finally {
      if (savedNumber === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_E164;
      else process.env.NEXT_PUBLIC_WHATSAPP_E164 = savedNumber;
      if (savedPrefill === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_PREFILL;
      else process.env.NEXT_PUBLIC_WHATSAPP_PREFILL = savedPrefill;
    }
  });
});

describe("the button is header chrome, in both languages", () => {
  test("the bar shows it at every width, and the drawer repeats the full label", () => {
    const nav = read("components/Navbar.tsx");
    const menuAt = nav.indexOf('id="mobile-menu"');
    const barAt = nav.indexOf("<WhatsAppContactButton />");
    const drawerAt = nav.indexOf('<WhatsAppContactButton variant="menu" />');
    assert.ok(barAt !== -1 && barAt < menuAt, "the bar button is above the drawer");
    assert.ok(drawerAt > menuAt, "the drawer has its own full-label link");
    assert.equal(nav.split("hidden lg:flex").length - 1, 2);
    assert.equal(nav.split("lg:hidden").length - 1, 2);
  });

  test("the control is an inline icon, a new tab, and an accessible name", () => {
    const button = read("components/WhatsAppContactButton.tsx");
    assert.match(button, /whatsAppContactHref\(\)/);
    assert.match(button, /target="_blank"/);
    assert.match(button, /rel="noopener noreferrer"/);
    assert.match(button, /aria-label=\{t\("whatsappAria"\)\}/);
    assert.match(button, /<svg[\s\S]*viewBox="0 0 24 24"/);
    assert.ok(!/from ["']lucide|react-icons|@heroicons/.test(button));
    assert.ok(!button.includes(PHONE), "the number stays in lib/site-contact.ts");
    assert.ok(!button.includes("wa.me"), "the link is built by the config");

    const ar = JSON.parse(read("messages/ar.json")).nav;
    const en = JSON.parse(read("messages/en.json")).nav;
    assert.equal(ar.whatsapp, "واتساب");
    assert.equal(ar.whatsappAria, "تواصل معنا عبر واتساب");
    assert.equal(en.whatsapp, "WhatsApp");
    assert.equal(en.whatsappAria, "Contact us on WhatsApp");
  });
});

describe("seller review still flags contact, and does not see this button", () => {
  const sellerSurfaces = [
    "lib/review-checklist.ts",
    "lib/review-checks-store.ts",
    "lib/file-facts.ts",
    "lib/listing-standards.ts",
    "lib/hosted-access/validate.ts",
    "app/shop/[slug]/page.tsx",
    "app/shop/[slug]/product/[productSlug]/page.tsx",
    "app/dashboard/shop/[slug]/add-product/page.tsx",
    "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
  ];

  test("a clean listing stays clean, and the same words inside a description are still a contact", () => {
    assert.equal(computeReviewChecks(cleanListing).points[6].state, "ok");
    const inDescription = computeReviewChecks({
      ...cleanListing,
      description: `${cleanListing.description}\nتواصل معنا عبر واتساب https://wa.me/${PHONE}`,
    });
    assert.equal(inDescription.points[6].state, "warn");
    const flags = findContactInfo(`تواصل معنا عبر واتساب https://wa.me/${PHONE}`);
    for (const flag of ["url", "phone", "phrase", "social"]) {
      assert.ok(flags.includes(flag as "url"), flag);
    }
  });

  test("the number and the link are not in seller-controlled text or the scanners", () => {
    const allowed = new Set([
      "lib/site-contact.ts",
      "tests/whatsapp-contact.test.ts",
      ".env.example",
    ]);
    for (const file of walk(ROOT)) {
      if (!/\.(ts|tsx|js|mjs|json|md|example)$/.test(file)) continue;
      const src = read(file);
      if (!src.includes(PHONE) && !src.includes("wa.me/966552319350")) continue;
      assert.ok(allowed.has(file), `${file} contains the platform WhatsApp number`);
    }

    for (const file of sellerSurfaces) {
      const src = read(file);
      assert.ok(!src.includes("site-contact"), file);
      assert.ok(!src.includes("WhatsAppContactButton"), file);
      assert.ok(!src.includes(PHONE), file);
      assert.ok(!src.includes("wa.me"), file);
      assert.ok(!src.includes("تواصل معنا عبر واتساب"), file);
    }

    for (const file of walk(resolve(ROOT, "lib/scan"))) {
      const src = read(file);
      assert.ok(!src.includes(PHONE) && !src.includes("site-contact") && !src.includes("wa.me"), file);
    }

    const productPage = read("app/shop/[slug]/product/[productSlug]/page.tsx");
    assert.match(productPage, /\{product\.description/);
    const store = read("lib/review-checks-store.ts");
    assert.ok(!store.includes("whatsapp") && !store.includes("Navbar"));
  });

  test("the stored check reads the title, the description, the page, and this file", async () => {
    const cleanPage = {
      audience: "مصممون مستقلون يريدون مخططًا جاهزًا للطباعة.",
      benefits: ["يوفر ساعة كل أحد"],
      included: ["ملف PDF من 12 صفحة"],
      faq: [{ question: "هل يعمل على الجوال؟", answer: "نعم. تفتح الملف من أي قارئ PDF." }],
      guarantee: "إن لم يناسبك الملف خلال سبعة أيام، نعيد المبلغ.",
    };
    const assets: Record<string, FileContentFacts> = {
      key_a: CLEAN_FACTS,
      key_old: { ...CLEAN_FACTS, contact: ["phone"] },
    };

    const clean = await storedPointSix({ ...productRow, landing: cleanPage }, assets);
    assert.equal(clean.ok, true);
    assert.equal(clean.point?.state, "ok");
    assert.match(clean.point?.reason ?? "", /صفحة المنتج/);

    const title = await storedPointSix(
      { ...productRow, name: "دفتر - واتساب 0551234567", landing: null },
      assets
    );
    assert.equal(title.point?.state, "warn");
    assert.match(title.point?.reason ?? "", /رقم هاتف \(العنوان\)/);
    assert.doesNotMatch(title.point?.reason ?? "", /صفحة المنتج/);

    const description = await storedPointSix(
      {
        ...productRow,
        description: `${cleanListing.description}\nتواصل معنا عبر واتساب https://wa.me/${PHONE}`,
        landing: null,
      },
      assets
    );
    assert.equal(description.point?.state, "warn");
    assert.match(description.point?.reason ?? "", /رابط.*\(الوصف\)/);
    assert.match(description.point?.reason ?? "", /رقم هاتف/);
    assert.match(description.point?.reason ?? "", /عبارة تواصل/);
    assert.match(description.point?.reason ?? "", /واتساب/);
    assert.doesNotMatch(description.point?.reason ?? "", /صفحة المنتج/);

    // Each seller-written part of the long-form page is part of the same scan.
    const page = await storedPointSix(
      {
        ...productRow,
        landing: {
          audience: "تواصل معنا لمن يريد المخطط",
          benefits: ["للطلب 0551234567"],
          included: ["تابع @my_store"],
          faq: [{ question: "أين أجد الملف؟", answer: "https://wa.me/966500000000" }],
          guarantee: "اكتب إلى seller@example.com",
        },
      },
      assets
    );
    assert.equal(page.point?.state, "warn");
    assert.match(page.point?.reason ?? "", /رقم هاتف، بريد إلكتروني، رابط، حساب @، عبارة تواصل \(صفحة المنتج\)/);
    assert.doesNotMatch(page.point?.reason ?? "", /العنوان|الوصف|الملف/);

    const file = await storedPointSix(
      { ...productRow, landing: null },
      { ...assets, key_a: { ...CLEAN_FACTS, contact: ["url"] } }
    );
    assert.equal(file.point?.state, "warn");
    assert.match(file.point?.reason ?? "", /رابط \(الملف\)/);

    const missing = await storedPointSix(null, assets);
    assert.equal(missing.ok, false);
    assert.equal(missing.point, null);
  });
});

const productRow = {
  name: cleanListing.name,
  description: cleanListing.description,
  landing: null as unknown,
  fileKey: "key_a",
  fileScanStatus: "SAFE",
  fileScanKey: "key_a",
};

/** Return only the columns the store actually selected, as Prisma would. */
function project<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return { ...row };
  const out: Partial<T> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key as keyof T] = row[key as keyof T];
  }
  return out;
}

async function storedPointSix(
  product: Record<string, unknown> | null,
  assets: Record<string, FileContentFacts>
): Promise<{ ok: boolean; point: { state: string; reason: string } | null }> {
  let point: { state: string; reason: string } | null = null;
  const db = {
    product: {
      findUnique: async (args: { select?: Record<string, boolean> }) =>
        product ? project(product, args.select) : null,
      updateMany: async (args: { data: { reviewChecks: { points: { 6: { state: string; reason: string } } } } }) => {
        point = args.data.reviewChecks.points[6];
        return { count: 1 };
      },
    },
    fileAsset: {
      findUnique: async (args: { where: { key: string }; select?: Record<string, boolean> }) => {
        const facts = assets[args.where.key];
        if (!facts) return null;
        return project({ contentFacts: facts }, args.select);
      },
    },
  };
  const ok = await refreshReviewChecks("prod_1", db as unknown as Prisma.TransactionClient);
  return { ok, point };
}
