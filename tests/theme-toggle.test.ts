/**
 * Light / dark theme. The header switch, the before-paint script, and the
 * light palette. Dark mode is the existing look: light rules are scoped to
 * html.light, and an explicit choice is what gets stored.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  THEME_STORAGE_KEY,
  isThemeChoice,
  nextTheme,
  themeCookie,
  themeFromPreference,
  themeInitScript,
} from "@/lib/theme";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function relLum(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const channel = (i: number) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const hi = Math.max(relLum(a), relLum(b));
  const lo = Math.min(relLum(a), relLum(b));
  return (hi + 0.05) / (lo + 0.05);
}

function lightVars(css: string): Record<string, string> {
  const block = css.match(/html\.light\s*\{([^}]*)\}/);
  assert.ok(block, "html.light token block");
  const vars: Record<string, string> = {};
  for (const match of block[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    vars[match[1]] = match[2];
  }
  return vars;
}

describe("theme preference", () => {
  test("no saved choice is dark, and an explicit choice wins", () => {
    assert.equal(themeFromPreference(null), "dark");
    assert.equal(themeFromPreference(undefined), "dark");
    assert.equal(themeFromPreference(""), "dark");
    assert.equal(themeFromPreference("system"), "dark");
    assert.equal(themeFromPreference("light"), "light");
    assert.equal(themeFromPreference("dark"), "dark");
    assert.equal(nextTheme("dark"), "light");
    assert.equal(nextTheme("light"), "dark");
    assert.equal(isThemeChoice("light"), true);
    assert.equal(isThemeChoice("nope"), false);
  });

  test("the cookie mirrors the storage key and does not outlive a year", () => {
    const cookie = themeCookie("light");
    assert.match(cookie, new RegExp(`^${THEME_STORAGE_KEY}=light;`));
    assert.match(cookie, /Path=\/;/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=31536000/);
    assert.equal(THEME_STORAGE_KEY, "saiflow-theme");
  });

  test("the blocking script reads localStorage, defaults to dark, and does not store a choice", () => {
    new Function(themeInitScript);
    assert.match(themeInitScript, /localStorage\.getItem/);
    assert.match(themeInitScript, /return "dark"/);
    assert.match(themeInitScript, /classList\.add\(mode\)/);
    assert.equal(themeInitScript.includes("prefers-color-scheme"), false);
    assert.equal(themeInitScript.includes("matchMedia"), false);
    assert.equal(themeInitScript.includes("setItem"), false);
    assert.equal(themeInitScript.includes("</"), false);
  });
});

describe("the switch is in the header, in both languages", () => {
  test("desktop bar and mobile menu each have one, without crowding the WhatsApp control", () => {
    const nav = read("components/Navbar.tsx");
    const menuAt = nav.indexOf('id="mobile-menu"');
    const barWhatsApp = nav.indexOf("<WhatsAppContactButton />");
    const barTheme = nav.indexOf("<ThemeToggle />");
    const menuWhatsApp = nav.indexOf('<WhatsAppContactButton variant="menu" />');
    const menuTheme = nav.indexOf('<ThemeToggle variant="menu" />');
    assert.ok(barWhatsApp !== -1 && barWhatsApp < menuAt);
    assert.ok(barTheme > barWhatsApp && barTheme < menuAt, "theme sits with WhatsApp in the bar");
    assert.ok(menuWhatsApp > menuAt);
    assert.ok(menuTheme > menuWhatsApp, "the menu repeats the theme switch");
    assert.equal(nav.split("hidden lg:flex").length - 1, 2);
    assert.equal(nav.split("lg:hidden").length - 1, 2);

    const button = read("components/ThemeToggle.tsx");
    assert.match(button, /type="button"/);
    assert.match(button, /localStorage\.setItem/);
    assert.match(button, /switchToLight/);
    assert.match(button, /switchToDark/);
    assert.match(button, /theme-icon-sun/);
    assert.match(button, /theme-icon-moon/);
    assert.equal(button.includes("prefers-color-scheme"), false);

    const ar = JSON.parse(read("messages/ar.json")).nav;
    const en = JSON.parse(read("messages/en.json")).nav;
    assert.equal(en.switchToLight, "Switch to light theme");
    assert.equal(en.switchToDark, "Switch to dark theme");
    assert.equal(ar.switchToLight, "التبديل إلى الوضع الفاتح");
    assert.equal(ar.switchToDark, "التبديل إلى الوضع الداكن");
  });

  test("the root layout applies the script before paint and renders a stored choice", () => {
    const layout = read("app/layout.tsx");
    assert.match(layout, /themeInitScript/);
    assert.match(layout, /suppressHydrationWarning/);
    assert.match(layout, /dangerouslySetInnerHTML/);
    const scriptAt = layout.indexOf("themeInitScript");
    const bodyAt = layout.indexOf("<body");
    assert.ok(scriptAt !== -1 && scriptAt < bodyAt);
    assert.match(layout, /isThemeChoice\(storedTheme\) \? storedTheme : "dark"/);
    assert.equal(layout.includes("prefers-color-scheme"), false);
  });
});

describe("light text meets WCAG AA and dark colors stay the default", () => {
  test("token pairs are AA, and the dark page background is unchanged", () => {
    const globals = read("app/globals.css");
    assert.match(globals, /--background:\s*#0a0a0a/);
    const light = read("app/theme-light.css");
    const vars = lightVars(light);
    const card = vars["--sf-card"];
    const page = vars["--sf-page"];
    const ink = vars["--sf-ink"];
    assert.equal(vars["--color-white"], ink, "text-white tracks the light ink");
    assert.equal(vars["--foreground"], ink);

    const textOn = [
      [ink, card],
      [ink, page],
      [vars["--sf-muted"], card],
      [vars["--sf-muted"], page],
      [vars["--color-gray-300"], card],
      [vars["--color-gray-400"], card],
      [vars["--color-gray-500"], page],
      [vars["--sf-teal-text"], card],
      [vars["--sf-teal-text"], page],
      [vars["--sf-teal-text-strong"], "#ccfbf1"],
      [vars["--sf-emerald-text"], card],
      [vars["--sf-red-text"], "#fef2f2"],
      [vars["--sf-amber-text"], card],
      [vars["--sf-blue-text"], card],
      [vars["--sf-purple-text"], card],
      [vars["--sf-cyan-text"], card],
      [vars["--sf-green-text"], card],
      [vars["--sf-orange-text"], card],
      [vars["--sf-pink-text"], card],
      // Teal buttons keep a dark label in light mode (text-white remaps to ink).
      [ink, "#14b8a6"],
      [ink, "#2dd4bf"],
      [ink, "#0d9488"],
      ["#0A1128", "#00FFB3"],
      // Unchanged gray-600 text on a lightened gray-600 button fill.
      ["#4b5563", "#d5dce5"],
    ] as const;

    for (const [fg, bg] of textOn) {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}, below 4.5`);
    }

    assert.ok(contrast(vars["--sf-input-border"], card) >= 3);
    assert.ok(contrast("#0f766e", card) >= 3, "focus outline against a card");

    // Color overrides live under html.light. The icon show/hide rules do not
    // set a color, so the dark palette is not rewritten at the root.
    assert.equal(light.includes(":root"), false);
    assert.match(light, /html\.light[\s\S]*--color-white/);
  });
});
