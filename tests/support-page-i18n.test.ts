/**
 * The rest of the support page, as copy only.
 *
 * Next to the FAQ (tests/support-faq.test.ts), the hero, the three contact
 * cards and the contact form used to be hardcoded English, so Arabic visitors
 * got an English page under an Arabic header. They now live in messages under
 * support.hero, support.contact and support.form. This checks that both
 * languages carry the same keys under `support`, that every key the page asks
 * for exists, that the page has no English left in its markup, and that the
 * subject values sent in the mailto did not change with the labels.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const ar = JSON.parse(read("messages/ar.json"));
const en = JSON.parse(read("messages/en.json"));
const page = read("app/support/page.tsx");
const jsx = page.slice(page.indexOf("return ("));
// The page without comments: section labels like {/* Twitter/X */} are not copy.
const code = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : leaves(value, path);
  });
}

function lookup(tree: Tree, path: string): string | Tree | undefined {
  return path.split(".").reduce<string | Tree | undefined>(
    (node, key) => (node && typeof node === "object" ? node[key] : undefined),
    tree,
  );
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("support messages", () => {
  test("Arabic and English have the same keys under support", () => {
    const enKeys = leaves(en.support).map(([path]) => path).sort();
    const arKeys = leaves(ar.support).map(([path]) => path).sort();
    assert.deepEqual(arKeys, enKeys);
    for (const section of ["hero", "contact", "form"]) {
      assert.ok(en.support[section], `en.json has support.${section}`);
    }
  });

  test("both languages use the same {placeholders}", () => {
    for (const [path, text] of leaves(en.support)) {
      assert.deepEqual(placeholders(lookup(ar.support, path) as string), placeholders(text), `support.${path}`);
    }
  });

  test("no text is empty or contains an HTML entity", () => {
    for (const [lang, messages] of [["en", en], ["ar", ar]] as const) {
      for (const [path, text] of leaves(messages.support)) {
        assert.ok(text.trim().length > 0, `${lang} support.${path} is empty`);
        assert.doesNotMatch(text, /&[a-z]+;|&#\d+;/i, `${lang} support.${path} contains an HTML entity`);
      }
    }
  });

  test("the Arabic page copy is Arabic", () => {
    for (const section of ["hero", "contact", "form"]) {
      for (const [path, text] of leaves(ar.support[section])) {
        if (path === "emailPlaceholder") continue;
        assert.match(text, /[؀-ۿ]/, `ar support.${section}.${path} has no Arabic`);
      }
    }
  });
});

describe("app/support/page.tsx", () => {
  test("every key the page asks for exists in both languages", () => {
    const used = [...page.matchAll(/tPage\("([^"]+)"/g)].map((m) => m[1]);
    assert.ok(used.length > 20, "the page reads its copy through tPage");
    for (const subject of ["general", "technical", "billing", "other"]) used.push(`form.subjects.${subject}`);
    for (const key of used) {
      assert.equal(typeof lookup(en.support, key), "string", `en support.${key}`);
      assert.equal(typeof lookup(ar.support, key), "string", `ar support.${key}`);
    }
    assert.ok(page.includes('useTranslations("support")'));
  });

  test("the subject values sent in the mailto are unchanged", () => {
    const values = [...page.matchAll(/\{ value: "([^"]+)", key: "(\w+)" \}/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(values, [
      ["General", "general"],
      ["Technical", "technical"],
      ["Billing", "billing"],
      ["Other", "other"],
    ]);
    assert.match(page, /<option key=\{value\} value=\{value\}>/);
    assert.match(page, /subject: "General"/, "the form still defaults to General");
  });

  test("no English is left in the markup", () => {
    const textNodes = [...jsx.matchAll(/>([^<>{}]*)</g)]
      .map((m) => m[1].trim())
      .filter((text) => /[A-Za-z]/.test(text));
    assert.deepEqual(textNodes, [], "JSX text outside messages");
    assert.doesNotMatch(jsx, /\b(placeholder|aria-label|title|alt)="/, "a user-facing attribute is a literal string");
    for (const old of [
      "How can we help?",
      "help you succeed",
      "Email Us",
      "Twitter/X",
      "Follow Us",
      "View FAQs",
      "Send Message",
      "Your name",
      "Tell us how we can help",
      "open your email client",
      "From: ${name}",
    ]) {
      assert.ok(!code.includes(old), `page still has "${old}"`);
    }
  });

  test("the support address is written once and used for both mailto links and the note", () => {
    assert.equal(page.split("support@saiflow.io").length - 1, 1);
    assert.ok(page.includes("mailto:${SUPPORT_EMAIL}"));
    assert.ok(page.includes('tPage("form.note", { email: SUPPORT_EMAIL })'));
  });

  test("the layout uses logical, not left/right, spacing and alignment", () => {
    assert.doesNotMatch(jsx, /\b(text-left|text-right|[mp][lr]-\d|left-\d|right-\d|space-x-\d)\b/);
  });
});
