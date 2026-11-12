/**
 * The public header's WhatsApp button is platform chrome.
 *
 * Sellers may not put a phone number, a wa.me link, or an off-platform
 * invitation in a listing. This suite checks that the site button lives in
 * one config and the header, and that the review pipeline still flags those
 * same strings when they are seller text — because that text is the title,
 * the description, and the uploaded file, never the header.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { computeReviewChecks, findContactInfo, type FileContentFacts } from "@/lib/review-checklist";
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
    assert.match(store, /name: true, description: true/);
    assert.ok(!store.includes("whatsapp") && !store.includes("Navbar"));
  });
});
