/**
 * The approved commission wording, as copy only.
 *
 * The page description states the 7% SaiFlow commission and the old "keep
 * 95%" promise appears nowhere. Carried over from the commission work
 * without any of its logic: this checks words, not money.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const ar = JSON.parse(read("messages/ar.json"));
const en = JSON.parse(read("messages/en.json"));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|json|md)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the old promise is gone", () => {
  test('no "Keep 95%" or "٩٥٪" anywhere in copy, pages or components', () => {
    const files = [
      ...walk(resolve(ROOT, "messages")),
      ...walk(resolve(ROOT, "app")),
      ...walk(resolve(ROOT, "components")),
      ...walk(resolve(ROOT, "lib")),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const claim of ["Keep 95", "95% of every", "٩٥٪", "بـ95", "keep 95", "Keep 93", "93% of every", "٩٣٪", "بـ93"]) {
        assert.ok(!text.includes(claim), `${file.replace(ROOT, "")} still says ${claim}`);
      }
    }
    assert.ok(en.meta.description.includes("SaiFlow commission: 7%."));
    assert.ok(ar.meta.description.includes("عمولة SaiFlow: 7%."));
  });
});

describe("the pricing pages agree with the description", () => {
  const FEE_TBA = ["Pricing details will be announced", "Pricing and payment details", "سيتم الإعلان عن تفاصيل الرسوم"];

  for (const [locale, m] of [["en", en], ["ar", ar]] as const) {
    test(`${locale}: /pricing and /features state 7% and no longer call fees TBA`, () => {
      assert.equal(m.pricing.tiers.rate, "7%");
      assert.equal(m.pricing.comparison.saiflowRate, "7%");
      assert.equal(m.features.cards.noFees.rate, "7%");
      for (const text of [m.pricing.tiers.rateNote, m.pricing.faq.a2, m.pricing.cta.subtitle, m.features.cards.noFees.description]) {
        assert.ok(text.includes("7%"), `states the commission: ${text}`);
      }
      const fees = JSON.stringify([m.pricing, m.features.cards.noFees]);
      for (const phrase of FEE_TBA) assert.ok(!fees.includes(phrase), `still says "${phrase}"`);
      // The monthly-fee cell must match the FAQ's "no monthly fees" answer.
      assert.notEqual(m.pricing.comparison.saiflowFree, m.pricing.tiers.ratePeriod);
      assert.ok(!["TBA", "قريباً"].includes(m.pricing.comparison.saiflowFree));
    });
  }
});
