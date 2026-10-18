/**
 * PageSpeed fixes (report of 2026-10-16, www.saiflow.io, desktop).
 *
 * What must hold:
 * - Product thumbnails go through Vercel's resizer whenever their host is
 *   one next.config.ts allows, and are shown unoptimized (never refused)
 *   otherwise. lib/image-hosts mirrors next.config.ts exactly.
 * - Resized images may be cached for a long time (upload URLs never change).
 * - The hero mascot, the page's largest image, is preloaded and fetched first.
 * - The footer's small print is readable (no gray-500/600 on the dark background).
 *
 * Behavioural for canOptimizeImage; structural (reads the source) for the rest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canOptimizeImage } from "../lib/image-hosts.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("seller uploads and the site's own images can be resized; anything else is left as it is", () => {
  for (const src of [
    "https://z09wl7xuez.ufs.sh/f/DJpEnwlSWZmltCQlh6owOxBJ7gDvW",
    "https://utfs.io/f/abc",
    "https://uploadthing.com/f/abc",
    "https://sea1.ingest.uploadthing.com/x",
    "https://lh3.googleusercontent.com/a/photo",
    "/mascot-headphones.png",
  ]) {
    assert.equal(canOptimizeImage(src), true, src);
  }
  for (const src of [
    "http://z09wl7xuez.ufs.sh/f/abc",
    "https://ufs.sh/f/abc",
    "https://evil-ufs.sh/f/abc",
    "https://ufs.sh.evil.com/f/abc",
    "https://example.com/a.png",
    "//example.com/a.png",
    "not a url",
    "",
  ]) {
    assert.equal(canOptimizeImage(src), false, src);
  }
});

test("lib/image-hosts names exactly the hosts next.config.ts allows", () => {
  const config = read("next.config.ts");
  const hosts = [...config.matchAll(/hostname:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(hosts, [
    "**.ufs.sh",
    "*.uploadthing.com",
    "lh3.googleusercontent.com",
    "sea1.ingest.uploadthing.com",
    "uploadthing.com",
    "utfs.io",
  ]);
  for (const host of hosts) {
    const sample = host.replace(/^\*\*?\./, "z09wl7xuez.");
    assert.equal(canOptimizeImage(`https://${sample}/f/x`), true, host);
  }
  const ttl = Number(/minimumCacheTTL:\s*(\d+)/.exec(config)?.[1]);
  assert.ok(ttl >= 24 * 60 * 60, "resized images are cached at least a day");
});

test("thumbnails are resized when they can be, and only unoptimized when they cannot", () => {
  const src = read("components/ProductThumbnail.tsx");
  assert.match(src, /unoptimized=\{!canOptimizeImage\(src\)\}/);
  assert.ok(!/\n\s*unoptimized\n/.test(src), "never unconditionally unoptimized");
  assert.match(src, /sizes=\{sizes\}/, "with the card's own sizes");
});

test("the hero mascot is preloaded and fetched first", () => {
  const hero = read("components/home/Hero.tsx");
  const image = hero.slice(hero.indexOf('src="/mascot-headphones.png"'), hero.indexOf("/>", hero.indexOf('src="/mascot-headphones.png"')));
  assert.match(image, /\bpriority\b/);
  assert.match(image, /fetchPriority="high"/);
});

test("the footer's small print is readable on its dark background", () => {
  const footer = read("components/Footer.tsx");
  const bottom = footer.slice(footer.indexOf("{/* Bottom row */}"));
  assert.ok(!/text-gray-(500|600)/.test(bottom.slice(0, bottom.indexOf("Social links"))), "copyright and registration lines");
  assert.match(footer, /<p className="text-xs text-gray-400">\{t\('footer.newsletterDesc'\)\}<\/p>/);
});
