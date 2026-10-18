/**
 * The support page FAQ, as copy only.
 *
 * The questions used to be a hardcoded English array in app/support/page.tsx,
 * with JSX entities (`&apos;`) inside plain JS strings, so visitors saw the
 * entity instead of an apostrophe. They now live in messages under
 * support.faq, in both languages. This checks that the two languages carry
 * the same keys, that the page asks for exactly the questions that exist,
 * and that no HTML entity has crept back into the text.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RECEIPT_LINK_TTL_DAYS } from "@/lib/download-links";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const ar = JSON.parse(read("messages/ar.json"));
const en = JSON.parse(read("messages/en.json"));
const page = read("app/support/page.tsx");

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : leaves(value, path);
  });
}

describe("support.faq", () => {
  test("Arabic and English have the same keys", () => {
    assert.ok(en.support?.faq, "en.json has support.faq");
    assert.ok(ar.support?.faq, "ar.json has support.faq");
    const enKeys = leaves(en.support.faq).map(([path]) => path).sort();
    const arKeys = leaves(ar.support.faq).map(([path]) => path).sort();
    assert.deepEqual(arKeys, enKeys);
    for (const item of Object.keys(en.support.faq.items)) {
      assert.deepEqual(Object.keys(en.support.faq.items[item]).sort(), ["answer", "question"], `en ${item}`);
    }
  });

  test("no text contains &apos; or any other HTML entity", () => {
    for (const [lang, messages] of [["en", en], ["ar", ar]] as const) {
      for (const [path, text] of leaves(messages.support.faq)) {
        assert.ok(!text.includes("&apos;"), `${lang} support.faq.${path} contains &apos;`);
        assert.doesNotMatch(text, /&[a-z]+;|&#\d+;/i, `${lang} support.faq.${path} contains an HTML entity`);
        assert.ok(text.trim().length > 0, `${lang} support.faq.${path} is empty`);
      }
    }
  });

  test("the page renders every question from messages and nothing hardcoded", () => {
    const match = page.match(/const FAQ_KEYS = \[([^\]]*)\]/);
    assert.ok(match, "app/support/page.tsx declares FAQ_KEYS");
    const keys = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...keys].sort(), Object.keys(en.support.faq.items).sort());
    assert.ok(page.includes('useTranslations("support.faq")'));
    assert.ok(!page.includes("&apos;Add"), "old hardcoded answers are gone");
    assert.ok(!page.includes("Frequently asked questions"), "FAQ heading comes from messages");
  });
});

describe("the answers say what the site does now", () => {
  const answers = (messages: typeof en) =>
    Object.values(messages.support.faq.items as Record<string, { answer: string }>).map((item) => item.answer).join("\n");

  test("the retired promises are gone", () => {
    const text = answers(en);
    for (const claim of ["live immediately", "lifetime", "take effect immediately", "within 30 days", "and more"]) {
      assert.ok(!text.includes(claim), `en FAQ still says "${claim}"`);
    }
  });

  test("products are reviewed and scanned before they appear", () => {
    assert.match(en.support.faq.items.createProduct.answer, /scanned automatically for safety/);
    assert.match(en.support.faq.items.createProduct.answer, /our team reviews/);
    assert.match(ar.support.faq.items.createProduct.answer, /يُفحص الملف تلقائيًا/);
    assert.match(ar.support.faq.items.createProduct.answer, /يراجع فريقنا/);
  });

  test("replacing an approved product's file sends it back to review", () => {
    assert.match(en.support.faq.items.editProduct.answer, /replace the file of an approved product, it goes back for review/);
    assert.match(ar.support.faq.items.editProduct.answer, /فيعود المنتج إلى المراجعة/);
  });

  test("the download link lasts as long as the receipt token does", () => {
    assert.ok(en.support.faq.items.delivery.answer.includes(`${RECEIPT_LINK_TTL_DAYS} days`));
    assert.ok(ar.support.faq.items.delivery.answer.includes(`${RECEIPT_LINK_TTL_DAYS} أيام`));
    assert.ok(en.support.faq.items.delivery.answer.includes('"My purchases"'));
    assert.ok(ar.support.faq.items.delivery.answer.includes("«مشترياتي»"));
  });

  test("the payout answer matches the payout model", () => {
    const enPayout = en.support.faq.items.payouts.answer;
    const arPayout = ar.support.faq.items.payouts.answer;
    for (const phrase of ["bank transfer", "Saudi bank account (IBAN) in your name", "based in Saudi Arabia", "international is coming soon", "announced when sales open"]) {
      assert.ok(enPayout.includes(phrase), `en payout answer lacks "${phrase}"`);
    }
    for (const phrase of ["بتحويل بنكي", "حساب بنكي سعودي (آيبان) باسمك", "المقيمين في السعودية", "التوسع الدولي قريبًا", "عند فتح البيع"]) {
      assert.ok(arPayout.includes(phrase), `ar payout answer lacks "${phrase}"`);
    }
    assert.ok(!/Geidea/i.test(enPayout + arPayout), "payout copy must not say Geidea pays sellers");
  });
});
