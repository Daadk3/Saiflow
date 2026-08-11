/**
 * Upload attack-surface reduction.
 *
 * These tests do not re-implement UploadThing's matching rules — they call
 * `matchFileType`, the exact function the server runs in
 * `uploadthing/dist/upload-builder` (`assertFilesMeetConfig`) to decide
 * whether an upload is allowed. A pass here means the real code path accepts
 * or rejects the file, not that a regex matched some source text.
 *
 * What is being proved: a signed-in user cannot obtain a public storage URL
 * for HTML, SVG or RAR through any SaiFlow upload route.
 *
 * What is NOT being proved: that accepted files are safe. Type matching reads
 * the browser's declared MIME type, falling back to the filename extension —
 * never the bytes. A renamed executable inside a ZIP still passes. Content
 * scanning remains outstanding and blocks enabling payments.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { matchFileType } from "@uploadthing/shared";
import { Micro } from "effect";

import {
  PRODUCT_FILE_CONFIG,
  PRODUCT_THUMBNAIL_CONFIG,
  SHOP_LOGO_CONFIG,
  SHOP_COVER_CONFIG,
} from "../lib/upload-config.ts";

type Config = Record<string, { maxFileSize: string }>;

const ROUTES: Record<string, Config> = {
  productFile: PRODUCT_FILE_CONFIG as unknown as Config,
  productThumbnail: PRODUCT_THUMBNAIL_CONFIG as unknown as Config,
  shopLogo: SHOP_LOGO_CONFIG as unknown as Config,
  shopCover: SHOP_COVER_CONFIG as unknown as Config,
};

/**
 * Resolve a file through the real matcher.
 *
 * Returns the config key the file resolves to, or null when rejected. The
 * server looks the size ceiling up under exactly this key, so the key is also
 * what decides which limit applies.
 */
function resolveKey(
  config: Config,
  name: string,
  type: string
): string | null {
  // `@uploadthing/shared` bundles its own copy of `effect` (3.17.7) while the
  // repo resolves 3.22.1 at the top level. Micro effects are plain data and
  // the two runtimes interoperate — the 44 assertions below execute through
  // the real matcher — but the two `Micro` types are nominally distinct, so
  // the identities have to be bridged here. This changes no behaviour.
  const effect = matchFileType(
    { name, size: 1, type },
    Object.keys(config) as never
  ) as unknown as Micro.Micro<string, unknown, never>;

  const exit = Micro.runSyncExit(effect);
  return Micro.exitIsSuccess(exit) ? exit.value : null;
}

/** The ceiling the server would actually enforce for this file. */
function ceilingFor(config: Config, name: string, type: string): string | null {
  const key = resolveKey(config, name, type);
  return key ? (config[key]?.maxFileSize ?? null) : null;
}

const accepted = (config: Config, name: string, type: string) =>
  resolveKey(config, name, type) !== null;

/* ------------------------------------------------------------------ */
/* The point of the change                                             */
/* ------------------------------------------------------------------ */

describe("blocked: active content and RAR", () => {
  // An empty declared type is included in every case because browsers often
  // send one — the matcher then falls back to the filename extension, and
  // that fallback must reject too.
  const mustReject: [string, string, string][] = [
    ["SVG (declared)", "logo.svg", "image/svg+xml"],
    ["SVG (no declared type)", "logo.svg", ""],
    ["HTML (declared)", "index.html", "text/html"],
    ["HTML (no declared type)", "index.html", ""],
    ["HTM", "index.htm", ""],
    ["JavaScript", "payload.js", "text/javascript"],
    ["plain text", "notes.txt", "text/plain"],
    ["RAR (x-rar-compressed)", "bundle.rar", "application/x-rar-compressed"],
    ["RAR (vnd.rar)", "bundle.rar", "application/vnd.rar"],
    ["RAR (no declared type)", "bundle.rar", ""],
    ["Windows executable", "setup.exe", "application/x-msdownload"],
  ];

  for (const [label, name, type] of mustReject) {
    test(`${label} is rejected by every route`, () => {
      for (const [route, config] of Object.entries(ROUTES)) {
        assert.equal(
          accepted(config, name, type),
          false,
          `${route} must reject ${name} [${type || "no type"}]`
        );
      }
    });
  }

  test("SVG cannot sneak through under an image extension", () => {
    // The declared type is what the matcher prefers, so an SVG announced as
    // image/svg+xml with a .png name must still fail on the declared type.
    assert.equal(
      accepted(PRODUCT_FILE_CONFIG as unknown as Config, "logo.png", "image/svg+xml"),
      false
    );
  });

  test("no route carries the image, text or blob shorthand", () => {
    // The shorthands are the hole itself: `image` expands to image/* (which
    // includes SVG), `text` to text/* (which includes HTML), and `blob`
    // accepts anything at all.
    for (const [route, config] of Object.entries(ROUTES)) {
      for (const shorthand of ["image", "text", "blob"]) {
        assert.ok(
          !(shorthand in config),
          `${route} must not use the '${shorthand}' shorthand`
        );
      }
    }
  });

  test("RAR is absent from the product-file config", () => {
    assert.ok(!("application/x-rar-compressed" in PRODUCT_FILE_CONFIG));
    assert.ok(!("application/vnd.rar" in PRODUCT_FILE_CONFIG));
  });
});

/* ------------------------------------------------------------------ */
/* What must keep working                                              */
/* ------------------------------------------------------------------ */

describe("preserved: the formats SaiFlow actually sells", () => {
  const mustAccept: [string, string, string, string][] = [
    // label, filename, declared type, expected resolved key
    ["PDF", "guide.pdf", "application/pdf", "pdf"],
    ["PDF (no declared type)", "guide.pdf", "", "pdf"],
    ["EPUB", "book.epub", "application/epub+zip", "application/epub+zip"],
    ["EPUB (no declared type)", "book.epub", "", "application/epub+zip"],
    ["ZIP", "pack.zip", "application/zip", "application/zip"],
    ["ZIP (no declared type)", "pack.zip", "", "application/zip"],
    ["MP3", "track.mp3", "audio/mpeg", "audio"],
    ["WAV (no declared type)", "track.wav", "", "audio"],
    ["MP4", "lesson.mp4", "video/mp4", "video"],
    ["MOV (no declared type)", "lesson.mov", "", "video"],
  ];

  for (const [label, name, type, expected] of mustAccept) {
    test(`${label} is still accepted on productFile`, () => {
      assert.equal(
        resolveKey(PRODUCT_FILE_CONFIG as unknown as Config, name, type),
        expected
      );
    });
  }

  // The two formats verified to exist in production today, plus the rest of
  // the raster set that image/* used to cover.
  const rasterCases: [string, string][] = [
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["art.png", "image/png"],
    ["art.webp", "image/webp"],
    ["anim.gif", "image/gif"],
    ["iphone.heic", "image/heic"],
    ["iphone.heif", "image/heif"],
    ["modern.avif", "image/avif"],
  ];

  for (const [name, type] of rasterCases) {
    test(`${type} is accepted on every image-bearing route`, () => {
      for (const [route, config] of Object.entries(ROUTES)) {
        assert.equal(
          resolveKey(config, name, type),
          type,
          `${route} must accept ${type}`
        );
      }
    });
  }

  test("JPEG and PNG — the only formats in production — work untyped too", () => {
    for (const [name, expected] of [
      ["photo.jpg", "image/jpeg"],
      ["art.png", "image/png"],
    ] as const) {
      assert.equal(
        resolveKey(PRODUCT_FILE_CONFIG as unknown as Config, name, ""),
        expected
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* Size ceilings                                                       */
/* ------------------------------------------------------------------ */

describe("size ceilings are the ones the server will enforce", () => {
  // ceilingFor() reproduces the server's own two steps: resolve the key via
  // matchFileType, then read maxFileSize under that key. Asserting the
  // constant alone would not prove the limit reaches the file.
  const expected: [string, string, string, string][] = [
    ["ZIP", "pack.zip", "application/zip", "128MB"],
    ["video", "lesson.mp4", "video/mp4", "256MB"],
    ["audio", "track.mp3", "audio/mpeg", "128MB"],
    ["PDF", "guide.pdf", "application/pdf", "32MB"],
    ["EPUB", "book.epub", "application/epub+zip", "32MB"],
    ["image", "art.png", "image/png", "32MB"],
  ];

  for (const [label, name, type, limit] of expected) {
    test(`${label} ceiling is ${limit}`, () => {
      assert.equal(
        ceilingFor(PRODUCT_FILE_CONFIG as unknown as Config, name, type),
        limit
      );
    });
  }

  test("ZIP and video were reduced from 512MB", () => {
    assert.notEqual(PRODUCT_FILE_CONFIG["application/zip"].maxFileSize, "512MB");
    assert.notEqual(PRODUCT_FILE_CONFIG.video.maxFileSize, "512MB");
  });

  test("the image routes keep their existing ceilings and single-file limit", () => {
    for (const [route, config, limit] of [
      ["productThumbnail", PRODUCT_THUMBNAIL_CONFIG, "16MB"],
      ["shopLogo", SHOP_LOGO_CONFIG, "4MB"],
      ["shopCover", SHOP_COVER_CONFIG, "8MB"],
    ] as const) {
      const entry = (config as unknown as Record<
        string,
        { maxFileSize: string; maxFileCount?: number }
      >)["image/png"];
      assert.equal(entry.maxFileSize, limit, `${route} ceiling`);
      assert.equal(entry.maxFileCount, 1, `${route} file count`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

describe("the router uses the shared config", () => {
  const core = readFileSync(
    new URL("../app/api/uploadthing/core.ts", import.meta.url),
    "utf8"
  );

  test("every route is built from lib/upload-config", () => {
    for (const name of [
      "PRODUCT_FILE_CONFIG",
      "PRODUCT_THUMBNAIL_CONFIG",
      "SHOP_LOGO_CONFIG",
      "SHOP_COVER_CONFIG",
    ]) {
      assert.ok(core.includes(`f(${name})`), `${name} must be wired into f()`);
    }
  });

  test("no inline type config survives in the router", () => {
    // A second, inline source of truth is how these two files drift apart.
    assert.ok(!/\bimage:\s*\{/.test(core), "inline image config left behind");
    assert.ok(!/\btext:\s*\{/.test(core), "inline text config left behind");
    assert.ok(!core.includes("x-rar-compressed"), "RAR left behind");
    assert.ok(!core.includes("512MB"), "512MB ceiling left behind");
  });

  test("the auth requirement is intact and now stricter", () => {
    // Stage B replaced the any-signed-in-user check with a per-shop
    // membership check. This asserts the stronger rule, not the old one.
    assert.ok(core.includes("getServerSession"));
    assert.ok(core.includes('throw new UploadThingError("Unauthorized")'));
    assert.equal(
      (core.match(/\.middleware\(requireShopMember\)/g) ?? []).length,
      4,
      "all four routes must require membership of the named shop"
    );
    assert.ok(
      !core.includes("requireUser"),
      "the weaker any-signed-in-user check must not return"
    );
  });
});
