/**
 * Every password field can show what was typed, and tells the browser what
 * kind of password it holds.
 *
 * Structural: these read the source. They prove the wiring (one shared
 * component, its accessible states, each page's autocomplete purpose, both
 * locales), not the rendered pixels.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(resolve(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx$/.test(name)) out.push(rel);
  }
  return out;
}

describe("the shared password field", () => {
  const component = strip(read("components/auth/PasswordInput.tsx"));

  test("it toggles only the input's type, starting hidden", () => {
    assert.match(component, /useState\(false\)/);
    assert.match(component, /type=\{visible \? "text" : "password"\}/);
    assert.match(component, /<input \{\.\.\.props\} type=/, "the caller's value, handlers and attributes pass through");
  });

  test("the button is a real, labelled toggle that never submits the form", () => {
    assert.match(component, /<button\s+type="button"/);
    assert.match(component, /aria-label=\{visible \? t\("hidePassword"\) : t\("showPassword"\)\}/);
    assert.match(component, /aria-pressed=\{visible\}/);
    assert.match(component, /aria-controls=\{props\.id\}/);
  });

  test("it sits at the inline end, so it follows the language direction", () => {
    assert.match(component, /absolute inset-y-0 end-0/);
    assert.match(component, /\bpe-12\b/, "typed text never runs under the button");
    assert.ok(!/\b(left|right)-0\b/.test(component), "no physical side");
  });
});

describe("every password field uses it", () => {
  test("no plain password input remains anywhere in the app", () => {
    for (const file of [...sources("app"), ...sources("components")]) {
      if (file.endsWith("PasswordInput.tsx")) continue;
      assert.ok(!/type="password"/.test(read(file)), `${file} still has a plain password input`);
    }
  });

  test("each field says whether it is a new or the current password", () => {
    const expected: Array<[string, string[]]> = [
      ["app/signup/page.tsx", ["new-password"]],
      ["app/login/page.tsx", ["current-password"]],
      ["app/verify-email/page.tsx", ["current-password"]],
      ["app/reset-password/page.tsx", ["new-password", "new-password"]],
    ];
    for (const [file, purposes] of expected) {
      const code = strip(read(file));
      const fields = [...code.matchAll(/<PasswordInput[\s\S]*?\/>/g)].map((m) => m[0]);
      assert.equal(fields.length, purposes.length, file);
      fields.forEach((field, i) => assert.ok(field.includes(`autoComplete="${purposes[i]}"`), `${file} field ${i + 1}`));
      assert.match(code, /import \{ PasswordInput \} from "@\/components\/auth\/PasswordInput";/);
    }
  });
});

describe("the reset page states the rule the server enforces", () => {
  test("8 characters with an uppercase letter, a lowercase letter and a number, in both languages", () => {
    const page = strip(read("app/reset-password/page.tsx"));
    assert.match(page, /password\.length < 8 \|\| !\/\^\(\?=\.\*\[a-z\]\)\(\?=\.\*\[A-Z\]\)\(\?=\.\*\\d\)\/\.test\(password\)/);
    assert.equal((page.match(/minLength=\{8\}/g) ?? []).length, 2);
    assert.ok(!page.includes("minLength={6}"));
    const server = read("lib/validations.ts");
    assert.match(server.slice(server.indexOf("export const resetPasswordSchema")), /\.min\(8,[\s\S]*?\[a-z\]\)\(\?=\.\*\[A-Z\]\)\(\?=\.\*\\d\)/);
    for (const lang of ["ar", "en"]) {
      const auth = JSON.parse(read(`messages/${lang}.json`)).auth;
      for (const text of [auth.resetPassword.heroSubtitle, auth.resetPassword.passwordTooShort]) {
        assert.match(text, /8/, `${lang}: ${text}`);
        assert.ok(!/\b6\b/.test(text), `${lang}: ${text}`);
      }
      assert.ok(auth.showPassword && auth.hidePassword, `${lang} toggle labels`);
    }
  });
});
