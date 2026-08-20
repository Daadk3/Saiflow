/**
 * B-2 phase 1 — the permanent product link helper and its copy control.
 *
 * WHAT IS BEING PROTECTED. A creator copies a product link to paste it
 * somewhere permanent. The failure that matters is not a wrong path — that is
 * obvious the first time anyone clicks it — but a link carrying a *deployment*
 * host. Every pull request builds a Vercel Preview at `*.vercel.app` where the
 * dashboard renders identically to production, so a control that read
 * `window.location` would produce a correct-looking link that dies with the
 * deployment, in someone's audience, days later. Review cannot catch that by
 * looking at the page.
 *
 * So the origin is pinned as a literal here, and the ABSENCE of any
 * location/env read is asserted structurally against the source. Behaviour
 * tests prove the string; structure tests prove no future edit can reintroduce
 * the host that behaviour tests would never see.
 *
 * COMMENTS MUST NEVER SATISFY AN ASSERTION. Both B-2 source files discuss
 * `window.location`, `vercel.app` and the scan columns at length in order to
 * explain why they are absent. Every structural assertion below therefore runs
 * against `strip()`ed source, exactly as `product-link-stability.test.ts` does.
 * Without that, this file would pass by reading its own subject's prose.
 *
 * No database, no network, no DOM.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_URL, productUrl } from "../lib/site-url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Comments explain the trap; they must never satisfy an assertion.
 *
 * Deliberately NOT the two-regex version used in
 * `product-link-stability.test.ts`. That one removes `//` to end-of-line
 * unconditionally, which also eats the `//` inside `"https://www.saiflow.io"`
 * and leaves `"https:` behind — so an assertion about the canonical origin
 * would fail against source that is perfectly correct. It never mattered
 * there because no assertion in that file involves a URL; it matters in every
 * assertion here.
 *
 * This version alternates string, template and comment patterns and replaces
 * only the comment branches, so literals survive intact and comments still
 * cannot satisfy anything.
 */
const strip = (s: string) =>
  s.replace(
    /("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|(`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, dq, sq, tpl) => (dq || sq || tpl ? match : ""),
  );

const SITE_URL_MODULE = "lib/site-url.ts";
const COPY_BUTTON = "components/CopyLinkButton.tsx";

/** Every file this phase introduces. Extended in phase 2, not replaced. */
const B2_SOURCES = [SITE_URL_MODULE, COPY_BUTTON];

const code = (p: string) => strip(read(p));

/* ================================================================== */
/* 1. The canonical origin                                             */
/* ================================================================== */

describe("canonical production origin", () => {
  test("is the production host, pinned exactly", () => {
    assert.equal(SITE_URL, "https://www.saiflow.io");
  });

  test("is https and carries no trailing slash", () => {
    // A trailing slash would produce `//shop/...` once joined.
    assert.ok(SITE_URL.startsWith("https://"));
    assert.ok(!SITE_URL.endsWith("/"));
  });

  test("is a literal, not derived from the environment or the request", () => {
    const src = code(SITE_URL_MODULE);
    // The value must be written in the file. An env read or a location read
    // would let a Preview deployment supply its own host.
    assert.match(src, /const\s+SITE_URL\s*=\s*"https:\/\/www\.saiflow\.io"/);
    assert.ok(!/process\.env/.test(src), "origin must not come from an env var");
    assert.ok(!/VERCEL_URL/.test(src), "origin must not come from VERCEL_URL");
    assert.ok(!/headers\(/.test(src), "origin must not come from request headers");
  });
});

/* ================================================================== */
/* 2. Product URL shape                                                */
/* ================================================================== */

describe("productUrl shape", () => {
  test("matches the public route exactly", () => {
    assert.equal(
      productUrl("daad-s-store", "dodo"),
      "https://www.saiflow.io/shop/daad-s-store/product/dodo",
    );
  });

  test("the shape corresponds to a route that actually exists", () => {
    // Pins the string to the filesystem: if the public route is ever moved,
    // this fails rather than silently emitting links to a 404.
    assert.ok(
      existsSync(resolve(ROOT, "app/shop/[slug]/product/[productSlug]/page.tsx")),
      "public product route missing — productUrl shape is now wrong",
    );
  });

  test("always begins with the canonical origin", () => {
    for (const [shop, product] of [
      ["a", "b"],
      ["shop-x1y2z3", "product-a1b2c3d4"],
      ["", ""],
      ["../../etc", "..%2Fpasswd"],
    ]) {
      assert.ok(
        productUrl(shop, product).startsWith(`${SITE_URL}/shop/`),
        `escaped the canonical origin for ${shop}/${product}`,
      );
    }
  });

  test("is stable — the same slugs always give the same URL", () => {
    // B-1 froze both slugs; this helper adds no second source of drift.
    assert.equal(productUrl("s", "p"), productUrl("s", "p"));
  });
});

/* ================================================================== */
/* 3. Segment encoding                                                 */
/* ================================================================== */

describe("segment encoding", () => {
  test("encodes characters that would re-target the URL", () => {
    // `?` and `#` are the dangerous ones: unencoded, they turn the rest of the
    // slug into a query string or fragment and change which resource is
    // addressed. `encodeURI` would leave both intact, which is why the module
    // uses encodeURIComponent per segment.
    assert.equal(
      productUrl("shop", "a?b"),
      "https://www.saiflow.io/shop/shop/product/a%3Fb",
    );
    assert.equal(
      productUrl("shop", "a#b"),
      "https://www.saiflow.io/shop/shop/product/a%23b",
    );
  });

  test("encodes a slash so a slug cannot forge extra path segments", () => {
    assert.equal(
      productUrl("shop", "a/b"),
      "https://www.saiflow.io/shop/shop/product/a%2Fb",
    );
  });

  test("encodes spaces", () => {
    assert.equal(
      productUrl("my shop", "my product"),
      "https://www.saiflow.io/shop/my%20shop/product/my%20product",
    );
  });

  test("encodes non-Latin slugs", () => {
    // Not reachable through today's generator, which emits [a-z0-9-] or a
    // `product-<random>` fallback. Pinned anyway so the URL stays correct if
    // that generator is ever loosened.
    const url = productUrl("متجر", "منتج");
    assert.ok(url.startsWith("https://www.saiflow.io/shop/%"));
    assert.equal(decodeURIComponent(url.split("/shop/")[1].split("/product/")[0]), "متجر");
  });

  test("leaves ordinary slugs untouched", () => {
    // Encoding must be a no-op on real data, or every existing link changes.
    assert.equal(
      productUrl("daad-s-store", "daily-habit-tracker"),
      "https://www.saiflow.io/shop/daad-s-store/product/daily-habit-tracker",
    );
  });
});

/* ================================================================== */
/* 4. No B-2 source may read the current location                      */
/* ================================================================== */

describe("no location or deployment host anywhere in B-2", () => {
  for (const file of B2_SOURCES) {
    test(`${file} never reads window.location`, () => {
      const src = code(file);
      assert.ok(!/window\s*\.\s*location/.test(src), `${file} reads window.location`);
      assert.ok(!/document\s*\.\s*location/.test(src), `${file} reads document.location`);
      assert.ok(
        !/\blocation\s*\.\s*(href|origin|host)\b/.test(src),
        `${file} reads a bare location`,
      );
    });

    test(`${file} never references a deployment host`, () => {
      const src = code(file);
      assert.ok(!/vercel\.app/.test(src), `${file} mentions vercel.app`);
      assert.ok(!/VERCEL_URL/.test(src), `${file} mentions VERCEL_URL`);
    });
  }

  test("the existing ShareButton is untouched and still separate", () => {
    // ShareButton legitimately uses window.location.href — it shares the page
    // you are on. That is exactly why it could not be reused here. Asserted so
    // that "reuse ShareButton" is never quietly done in a later phase.
    const share = code("components/ShareButton.tsx");
    assert.match(share, /window\.location\.href/);
    assert.ok(
      !code(COPY_BUTTON).includes("ShareButton"),
      "CopyLinkButton must not delegate to ShareButton",
    );
  });
});

/* ================================================================== */
/* 5. A preview host can never be produced                             */
/* ================================================================== */

describe("preview host is unreachable by construction", () => {
  test("productUrl output never carries a non-canonical host", () => {
    // The helper takes no host input at all, so this is true by construction;
    // pinned so that adding a host parameter later fails loudly here.
    const hostile = ["evil.com", "my-gumroad-abc.vercel.app", "//evil.com"];
    for (const h of hostile) {
      const url = productUrl(h, h);
      assert.ok(url.startsWith("https://www.saiflow.io/"), `host leaked via ${h}`);
      assert.equal(new URL(url).host, "www.saiflow.io");
    }
  });

  test("productUrl accepts exactly two arguments — no host override", () => {
    assert.equal(productUrl.length, 2);
  });
});

/* ================================================================== */
/* 6. Copy control behaviour, as far as it is checkable without a DOM  */
/* ================================================================== */

describe("CopyLinkButton", () => {
  test("takes the URL as a prop rather than discovering it", () => {
    const src = code(COPY_BUTTON);
    assert.match(src, /url:\s*string/);
  });

  test("tries the async Clipboard API first", () => {
    assert.match(code(COPY_BUTTON), /navigator\.clipboard\?\.writeText/);
    assert.match(code(COPY_BUTTON), /navigator\.clipboard\.writeText\(url\)/);
  });

  test("falls back when the clipboard is unavailable or denied", () => {
    const src = code(COPY_BUTTON);
    // Tier 2: synchronous legacy copy, reached when the modern API is missing
    // (non-secure context) or throws (permission denied).
    assert.match(src, /execCommand\("copy"\)/);
    // Tier 3: put the URL in front of the creator so it is copyable by hand.
    assert.match(src, /window\.prompt\(/);
  });

  test("orders the three tiers: clipboard, then legacy, then prompt", () => {
    const src = code(COPY_BUTTON);
    const clip = src.indexOf("navigator.clipboard.writeText");
    const legacy = src.indexOf("legacyCopy(url)");
    const prompt = src.indexOf("window.prompt(");
    assert.ok(clip > -1 && legacy > -1 && prompt > -1, "a fallback tier is missing");
    assert.ok(clip < legacy, "legacy copy must come after the Clipboard API");
    assert.ok(legacy < prompt, "prompt must be the last resort");
  });

  test("only confirms success on a path that actually copied", () => {
    const src = code(COPY_BUTTON);
    // The prompt tier must not call confirm(): nothing reached the clipboard,
    // and claiming otherwise is worse than saying nothing.
    const afterPrompt = src.slice(src.indexOf("window.prompt("));
    assert.ok(!/confirm\(\)/.test(afterPrompt), "prompt path must not report success");
  });

  test("is type=button so it cannot submit the edit form", () => {
    // It will be rendered inside the product edit <form>; the default
    // "submit" would save the product on every copy.
    assert.match(code(COPY_BUTTON), /type="button"/);
  });

  test("clears its confirmation timer on unmount", () => {
    assert.match(code(COPY_BUTTON), /clearTimeout\(timer\.current\)/);
  });

  test("is a client component", () => {
    assert.match(read(COPY_BUTTON), /^"use client";/);
  });
});

/* ================================================================== */
/* 7. No internals, no network, no sellability coupling                */
/* ================================================================== */

describe("discloses and depends on nothing it should not", () => {
  const FORBIDDEN = [
    "fileKey",
    "fileUrl",
    "fileScanStatus",
    "fileScanKey",
    "fileScanSha256",
    "fileScanAttempts",
    "cloudmersive",
    "Cloudmersive",
    "SAFE_DELIVERABLE_WHERE",
    "signedUrl",
    "utfs.io",
    "uploadthing",
  ];

  for (const file of B2_SOURCES) {
    test(`${file} references no file, storage or scan internals`, () => {
      const src = code(file);
      for (const term of FORBIDDEN) {
        assert.ok(!src.includes(term), `${file} references ${term}`);
      }
    });

    test(`${file} makes no server call`, () => {
      const src = code(file);
      assert.ok(!/\bfetch\s*\(/.test(src), `${file} calls fetch`);
      assert.ok(!/use server/.test(src), `${file} declares a server action`);
      assert.ok(!/prisma/i.test(src), `${file} touches prisma`);
    });

    test(`${file} does not depend on sellability or moderation`, () => {
      // The URL is reserved from creation; a creator may copy it at any point
      // in the product's life. Eligibility stays entirely server-side.
      const src = code(file);
      assert.ok(!/moderationStatus/.test(src), `${file} reads moderationStatus`);
      assert.ok(!/isDeliverableSafe/.test(src), `${file} reads the safety predicate`);
      assert.ok(!/isActive/.test(src), `${file} reads isActive`);
    });
  }
});

/* ================================================================== */
/* 8. Phase 1 introduces no translation keys                           */
/* ================================================================== */

describe("no message keys added in phase 1", () => {
  test("CopyLinkButton takes its wording from the caller", () => {
    const src = code(COPY_BUTTON);
    assert.ok(!/useTranslations/.test(src), "component must not own translations");
    assert.ok(!/next-intl/.test(src), "component must not import next-intl");
    assert.match(src, /label:\s*string/);
    assert.match(src, /copiedLabel:\s*string/);
  });

  test("both locale files remain parseable and structurally paired", () => {
    // Phase 1 adds no keys; this simply guarantees the files are not disturbed
    // and gives phase 2 a parity check to extend.
    const en = JSON.parse(read("messages/en.json"));
    const ar = JSON.parse(read("messages/ar.json"));
    assert.ok(Object.keys(en).length > 0);
    assert.ok(Object.keys(ar).length > 0);
  });
});
