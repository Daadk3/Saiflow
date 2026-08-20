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

/* ================================================================== */
/* 9. PHASE 2 — the two surfaces that render the link                  */
/* ================================================================== */

/**
 * Phase 2 wires the phase-1 primitives into the creator product row and the
 * product edit page, and adds the three status sentences.
 *
 * These assertions are structural because the repo has no DOM harness: the
 * pages are `.tsx`, which Node's native TypeScript loader cannot import
 * without a JSX transform. So the mapping itself is tested behaviourally
 * through `lib/product-link-status.ts` — a plain module precisely so that the
 * one piece of real logic is not left to source-shape assertions — and the
 * rendering is pinned by reading the JSX.
 */

import {
  productLinkStatus,
  productLinkStatusKey,
  type ProductLinkStatus,
} from "../lib/product-link-status";

const ROW_PAGE = "app/dashboard/shop/[slug]/page.tsx";
const EDIT_PAGE = "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx";

/** Every file B-2 touches. The phase-1 rules apply to all of them. */
const B2_PHASE2_SOURCES = [ROW_PAGE, EDIT_PAGE];

/* ---- 9a. Status mapping: the only real logic in phase 2 ------------ */

describe("productLinkStatus mapping", () => {
  const SAFETIES = ["ready", "checking", "needs_attention", "blocked", null] as const;

  test("APPROVED with a ready file is the only live combination", () => {
    for (const fileSafety of SAFETIES) {
      const status = productLinkStatus({ moderationStatus: "APPROVED", fileSafety });
      assert.equal(
        status,
        fileSafety === "ready" ? "live" : "reserved",
        `APPROVED + ${fileSafety} mapped to ${status}`,
      );
    }
  });

  test("PENDING is reserved whatever the file says", () => {
    for (const fileSafety of SAFETIES) {
      assert.equal(productLinkStatus({ moderationStatus: "PENDING", fileSafety }), "reserved");
    }
  });

  test("a missing moderation status is reserved, never live", () => {
    // The seller payload marks moderationStatus optional; absent must not be
    // read as approval.
    assert.equal(productLinkStatus({ fileSafety: "ready" }), "reserved");
    assert.equal(productLinkStatus({ moderationStatus: null, fileSafety: "ready" }), "reserved");
  });

  test("REJECTED takes precedence over every file state, including ready", () => {
    // The case that makes precedence matter: moderation rejects a listing on
    // its CONTENT, which says nothing about the bytes — so a rejected product
    // with a SAFE deliverable is reachable, and is exactly where a
    // ready-first ordering would tell the creator their link is live.
    for (const fileSafety of SAFETIES) {
      assert.equal(
        productLinkStatus({ moderationStatus: "REJECTED", fileSafety }),
        "rejected",
        `REJECTED + ${fileSafety} escaped the rejected state`,
      );
    }
  });

  test("every state maps to a distinct message key", () => {
    const seen = new Set<string>();
    for (const s of ["live", "reserved", "rejected"] as ProductLinkStatus[]) {
      const key = productLinkStatusKey(s);
      assert.ok(!seen.has(key), `${key} used twice`);
      seen.add(key);
    }
    assert.equal(seen.size, 3);
  });

  test("the status module reads no scan internals and makes no server call", () => {
    const src = code("lib/product-link-status.ts");
    for (const term of ["fileScanStatus", "fileScanKey", "fileKey", "prisma", "fetch("]) {
      assert.ok(!src.includes(term), `status module references ${term}`);
    }
    // The type import is erased at compile time; a VALUE import would drag the
    // server-only Prisma clause into the client bundle.
    assert.match(read("lib/product-link-status.ts"), /import type \{ CreatorFileStatus \}/);
  });
});

/* ---- 9b. Phase-1 rules extend to the pages ------------------------- */

describe("phase 2 pages obey the phase 1 rules", () => {
  for (const file of B2_PHASE2_SOURCES) {
    test(`${file} never reads window.location`, () => {
      const src = code(file);
      assert.ok(!/window\s*\.\s*location/.test(src), `${file} reads window.location`);
      assert.ok(!/vercel\.app/.test(src), `${file} mentions vercel.app`);
      assert.ok(!/VERCEL_URL/.test(src), `${file} mentions VERCEL_URL`);
    });

    test(`${file} builds the URL with productUrl()`, () => {
      const src = code(file);
      assert.match(src, /from "@\/lib\/site-url"/);
      assert.match(src, /productUrl\(/);
      // No hand-rolled second copy of the origin.
      assert.ok(
        !/["'`]https:\/\/www\.saiflow\.io/.test(src),
        `${file} hardcodes the origin instead of importing it`,
      );
    });

    test(`${file} renders no raw scan enum, provider or file internals`, () => {
      const src = code(file);
      for (const term of [
        "fileScanStatus", "fileScanKey", "fileScanSha256", "fileScanAttempts",
        "cloudmersive", "Cloudmersive", "SAFE_DELIVERABLE_WHERE", "utfs.io", "signedUrl",
      ]) {
        assert.ok(!src.includes(term), `${file} references ${term}`);
      }
    });
  }
});

/* ---- 9c. The product row ------------------------------------------- */

describe("creator product row", () => {
  test("shows the full canonical URL, not just the slug", () => {
    const src = code(ROW_PAGE);
    assert.match(src, /productUrl\(shop\.slug, product\.slug\)/);
    // The bare "/{slug}" line it replaced told a creator nothing they could
    // paste anywhere.
    assert.ok(!/>\s*\/\{product\.slug\}\s*</.test(src), "bare slug line still present");
  });

  test("renders a copy control", () => {
    const src = code(ROW_PAGE);
    assert.match(src, /import CopyLinkButton from "@\/components\/CopyLinkButton"/);
    assert.match(src, /<CopyLinkButton/);
  });

  test("the link is not gated on moderation, file safety or file presence", () => {
    // The regression this guards: the URL used to be the ELSE branch of the
    // missing-file check, so it was hidden from exactly the creators still
    // setting a product up. Assert the copy control sits outside any such
    // conditional by checking no gating expression precedes it on its branch.
    const src = code(ROW_PAGE);
    const block = src.slice(src.indexOf("<CopyLinkButton"), src.indexOf("<CopyLinkButton") + 400);
    for (const gate of ["hasFile", "moderationStatus ===", 'fileSafety === "ready"']) {
      assert.ok(!block.includes(gate), `copy control appears gated on ${gate}`);
    }
    // And the ternary form is gone entirely.
    assert.ok(
      !/\{!product\.hasFile \? \(/.test(src),
      "missing-file check is still an either/or with the link",
    );
  });

  test("keeps the missing-file warning", () => {
    const src = code(ROW_PAGE);
    assert.match(src, /!product\.hasFile && \(/);
    assert.match(src, /uploadFileWarning/);
  });

  test("the eye / view-public action is unchanged and still distinct", () => {
    const src = code(ROW_PAGE);
    // Still a Link to the public page, still labelled by its own key.
    assert.match(src, /href=\{`\/shop\/\$\{shop\.slug\}\/product\/\$\{product\.slug\}`\}/);
    assert.match(src, /viewProductTitle/);
    // The copy control is a button, the eye is a link — they cannot collapse
    // into the same affordance.
    assert.ok(src.includes("<CopyLinkButton"));
  });

  test("keeps the edit and delete actions", () => {
    const src = code(ROW_PAGE);
    assert.match(src, /editProductTitle/);
    assert.match(src, /deleteProductTitle/);
    assert.match(src, /handleDeleteProduct/);
  });

  test("renders the URL left-to-right so RTL cannot reorder it visually", () => {
    assert.match(code(ROW_PAGE), /dir="ltr"/);
  });
});

/* ---- 9d. The edit page --------------------------------------------- */

describe("product edit page URL box", () => {
  test("sits after Category and before Product File", () => {
    const src = code(EDIT_PAGE);
    const category = src.indexOf("categoryHelp");
    const box = src.indexOf('tLink("label")');
    const file = src.indexOf("productFileLabel");
    assert.ok(category > -1 && box > -1 && file > -1, "a landmark is missing");
    assert.ok(category < box, "URL box must come after Category");
    assert.ok(box < file, "URL box must come before Product File");
  });

  test("shows the full canonical URL", () => {
    assert.match(code(EDIT_PAGE), /productUrl\(product\.shop\.slug, product\.slug\)/);
  });

  test("the URL is displayed, never editable", () => {
    const src = code(EDIT_PAGE);
    const box = src.slice(src.indexOf('tLink("label")'), src.indexOf("productFileLabel"));
    // No input, no textarea, no contentEditable, no setter for the slug.
    assert.ok(!/<input/i.test(box), "URL box contains an input");
    assert.ok(!/<textarea/i.test(box), "URL box contains a textarea");
    assert.ok(!/contentEditable/i.test(box), "URL box is contentEditable");
    assert.ok(!/setSlug|slug:/.test(box), "URL box exposes a slug setter");
  });

  test("the slug is never sent back on save", () => {
    // B-1 froze it server-side; this makes the client agree rather than rely
    // on the server to discard it.
    const src = code(EDIT_PAGE);
    const body = src.slice(src.indexOf("JSON.stringify({"), src.indexOf("JSON.stringify({") + 400);
    assert.ok(!/\bslug\b/.test(body), "save payload includes a slug");
  });

  test("derives fileSafety from the shop payload, not a new API field", () => {
    const src = code(EDIT_PAGE);
    assert.match(src, /setFileSafety\(foundProduct\.fileSafety \?\? null\)/);
    // The product route must not have been asked for it.
    assert.ok(
      !/fileSafety.*productData|productData\.fileSafety/.test(src),
      "expects fileSafety from GET /api/products/[id]",
    );
  });

  test("copy control is type=button inside the form", () => {
    // Verified on the component itself in section 6; re-pinned here because
    // this is the surface where a submit-by-default would save the product.
    assert.match(code(EDIT_PAGE), /<form/);
    assert.match(code("components/CopyLinkButton.tsx"), /type="button"/);
  });
});

/* ---- 9e. Status copy is wired and safe ----------------------------- */

describe("status copy", () => {
  const en = JSON.parse(read("messages/en.json"));
  const ar = JSON.parse(read("messages/ar.json"));

  test("both locales define the productLink namespace", () => {
    assert.ok(en.productLink, "en.json missing productLink");
    assert.ok(ar.productLink, "ar.json missing productLink");
  });

  test("EN/AR key parity", () => {
    assert.deepEqual(Object.keys(en.productLink).sort(), Object.keys(ar.productLink).sort());
    assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
  });

  test("every status maps to a key that exists in both locales", () => {
    for (const s of ["live", "reserved", "rejected"] as ProductLinkStatus[]) {
      const key = productLinkStatusKey(s);
      assert.ok(typeof en.productLink[key] === "string" && en.productLink[key].length > 0, `en ${key}`);
      assert.ok(typeof ar.productLink[key] === "string" && ar.productLink[key].length > 0, `ar ${key}`);
    }
  });

  test("copy, copied, label and aria strings exist in both locales", () => {
    for (const key of ["copy", "copied", "label", "copyAria"]) {
      assert.ok(en.productLink[key], `en ${key}`);
      assert.ok(ar.productLink[key], `ar ${key}`);
    }
  });

  test("Arabic strings are actually Arabic, not copied English", () => {
    for (const [key, value] of Object.entries(ar.productLink)) {
      assert.match(value as string, /[؀-ۿ]/, `ar.productLink.${key} has no Arabic`);
      assert.notEqual(value, en.productLink[key], `ar.productLink.${key} is untranslated`);
    }
  });

  test("no status string leaks an internal enum or provider name", () => {
    const LEAKS = [
      "PENDING", "APPROVED", "REJECTED", "SAFE", "UNSAFE",
      "fileScanStatus", "fileKey", "Cloudmersive", "cloudmersive",
      "needs_attention", "moderationStatus", "SAFE_DELIVERABLE_WHERE",
    ];
    for (const locale of [en, ar]) {
      for (const [key, value] of Object.entries(locale.productLink)) {
        for (const leak of LEAKS) {
          assert.ok(!(value as string).includes(leak), `${key} leaks "${leak}"`);
        }
      }
    }
  });

  test("both surfaces render the status through the shared mapping", () => {
    // One mapping, two callers — so the wording cannot drift between them.
    for (const file of B2_PHASE2_SOURCES) {
      const src = code(file);
      assert.match(src, /productLinkStatusKey\(/, `${file} does not use the shared key map`);
      assert.match(src, /productLinkStatus\(/, `${file} does not use the shared mapping`);
    }
  });
});

/* ---- 9f. The gates B-2 must not have touched ----------------------- */

describe("public and payment gates are byte-identical", () => {
  test("the E2 safety predicate is untouched", () => {
    const src = read("lib/file-safety.ts");
    assert.ok(src.includes("product.fileKey !== null &&"));
    assert.ok(src.includes('product.fileScanStatus === "SAFE" &&'));
    assert.ok(src.includes("product.fileScanKey === product.fileKey"));
    assert.ok(src.includes("fileScanKey: { equals: prisma.product.fields.fileKey }"));
  });

  test("the creator file-status vocabulary is untouched", () => {
    const src = read("lib/creator-file-status.ts");
    for (const reason of [
      '"safe"', '"pending_scan"', '"scan_key_mismatch"',
      '"scan_error"', '"unsafe"', '"missing_file_key"',
    ]) {
      assert.ok(src.includes(reason), `creatorFileStatus lost the ${reason} case`);
    }
  });

  test("the seller shop payload still ships no scan internals", () => {
    const src = read("app/api/shops/[slug]/route.ts");
    // The response map sends the derived verdict, never the columns.
    assert.ok(src.includes("fileSafety: creatorFileStatus(p)"));
    assert.ok(src.includes("hasFile: p.fileKey !== null"));
  });

  test("checkout, download and the pre-launch gate are untouched", () => {
    assert.ok(read("app/api/checkout/route.ts").includes("env.PRE_LAUNCH_MODE"));
    assert.ok(
      read("app/api/download/[productId]/route.ts").includes(
        "Not authorized to download this product",
      ),
    );
  });

  test("B-2 added no API route and no migration", () => {
    // Phase 2 is UI plus messages plus two pure modules. If either of these
    // ever needs to change, that is a different review.
    for (const file of [...B2_SOURCES, ...B2_PHASE2_SOURCES, "lib/product-link-status.ts"]) {
      assert.ok(!file.startsWith("app/api/"), `${file} is an API route`);
      assert.ok(!file.startsWith("prisma/"), `${file} is a schema file`);
    }
  });
});

/* ================================================================== */
/* 10. RESPONSIVE ROW LAYOUT                                           */
/* ================================================================== */

/**
 * The permanent-URL line added a nowrap element and two more lines into the
 * product row's information column, which pushed the row past the width its
 * flex chain could absorb: below ~1055px the price and the eye/edit/delete
 * cluster left the canvas, and at 375px the Copy control was unreachable. The
 * threshold moved with slug length, which is the signature of a shrink bug
 * rather than a breakpoint one — so both were fixed.
 *
 * READ THIS BEFORE TRUSTING THESE TESTS. They pin CLASS STRUCTURE, not
 * rendered geometry. Nothing here measures a pixel, and nothing here can:
 * there is no DOM harness in this repo, so no assertion below would notice if
 * the row still overflowed. Their job is narrower and still worth doing —
 * they stop a later edit from silently reverting a decision that was made for
 * a reason. The five-width Preview QA is the real gate.
 */

describe("responsive product row", () => {
  const row = code(ROW_PAGE);

  /** The className string of the product row container itself. */
  const rowClass = (() => {
    const m = row.match(/className="(group flex[^"]*)"/);
    assert.ok(m, "product row container not found");
    return m![1];
  })();

  test("the row stacks below xl, not below sm or lg", () => {
    // sm was far too early. lg was measurably too early as well: at 1024px the
    // horizontal row fitted with roughly 30px to spare, which is no margin at
    // all on a row whose width grows with slug length — and it bled ~31px out
    // of its bordered container in QA.
    assert.match(rowClass, /\bxl:flex-row\b/);
    assert.match(rowClass, /\bxl:items-center\b/);
    assert.ok(!/\bsm:flex-row\b/.test(rowClass), "row still switches at sm");
    assert.ok(!/\bsm:items-center\b/.test(rowClass), "row still centres at sm");
    assert.ok(!/\blg:flex-row\b/.test(rowClass), "row still switches at lg");
    assert.ok(!/\blg:items-center\b/.test(rowClass), "row still centres at lg");
  });

  test("the row is a grid item and carries min-w-0", () => {
    // The row is a DIRECT child of `grid gap-4`, and grid items default to
    // min-width:auto — which resolves to their min-content size. Without this
    // override the auto track adopted the row's ~707px minimum and refused to
    // go below it, which is how a 707px card ended up inside a 373px
    // container. This is what lets the track follow the content down.
    assert.match(row, /className="grid gap-4"/);
    assert.match(rowClass, /\bmin-w-0\b/);
  });

  test("the row container is deliberately NOT overflow-hidden", () => {
    // Explicitly excluded: clipping the outer row would mask the sizing bug
    // rather than fix it, and could swallow focus rings on the action buttons.
    // Containment belongs on the information column, which is what shrinks.
    assert.ok(
      !/\boverflow-hidden\b/.test(rowClass),
      "outer row gained overflow-hidden — the fix is flex sizing, not clipping",
    );
  });

  test("the information column can shrink AND contains what it holds", () => {
    // min-w-0 alone lets the column shrink while its children spill out of it
    // and over the price and actions. Both classes are required together.
    assert.match(row, /className="flex-1 min-w-0 overflow-hidden"/);
  });

  test("the name row can shrink and the heading truncates", () => {
    // An untruncated h3 sets a min-content floor for the whole column, which
    // is why the failure threshold tracked the product name / slug length.
    assert.match(row, /className="flex items-center gap-2 min-w-0"/);
    assert.match(row, /className="font-semibold text-white group-hover:text-teal-400 transition-colors truncate"/);
  });

  test("the full product name survives truncation via title", () => {
    assert.match(row, /title=\{product\.name\}/);
  });

  test("the copy control sits in a shrink-0 wrapper", () => {
    // It cannot carry the class itself: CopyLinkButton's `className` prop
    // REPLACES its whole default style string, and that component is out of
    // scope here. The wrapper is the only non-invasive lever.
    const i = row.indexOf('className="shrink-0"');
    assert.ok(i > -1, "copy control has no shrink-0 wrapper");
    const after = row.slice(i, i + 200);
    assert.match(after, /<CopyLinkButton/, "shrink-0 wrapper does not wrap CopyLinkButton");
  });

  test("CopyLinkButton itself was not modified to achieve this", () => {
    const btn = code("components/CopyLinkButton.tsx");
    assert.match(btn, /className=\{className \?\? DEFAULT_CLASS\}/);
    assert.ok(!/shrink-0"/.test(btn.split("DEFAULT_CLASS =")[1]?.split(";")[0] ?? ""),
      "DEFAULT_CLASS was edited instead of using a wrapper");
  });

  test("the URL still truncates rather than wraps", () => {
    // Wrapping a 60-character URL at 375px would take three lines and push the
    // actions further down. The creator copies this string, they do not read it.
    assert.match(row, /className="text-xs text-gray-500 font-mono truncate flex-1 min-w-0"/);
    assert.ok(!/break-all/.test(row), "row URL now wraps instead of truncating");
    assert.match(row, /dir="ltr"/);
  });

  test("price and actions share one line below xl and dissolve at xl", () => {
    assert.match(row, /className="flex items-center justify-between gap-4 xl:contents"/);
    assert.ok(!/lg:contents/.test(row), "wrapper still dissolves at lg");
  });

  test("the URL span is a flexible item, not merely a shrinkable one", () => {
    // THE load-bearing assertion of this patch. `truncate` sets
    // white-space:nowrap, so with flex-basis:auto the span's flex BASE SIZE
    // was the full URL width (~477px measured in QA). A flex item only shrinks
    // from its base size against a DEFINITE container, and below the
    // breakpoint the grid track, row and info column are all sized
    // intrinsically — so there was nothing to shrink against and the 477px
    // propagated outward into the row's ~707px minimum.
    //
    // flex-1 is `flex: 1 1 0%`: base size 0. The span contributes nothing
    // intrinsically and grows into whatever space remains. min-w-0 stays
    // because it defeats the automatic minimum once the item is flexible.
    // Neither class is sufficient alone, which is why both are pinned here.
    const m = row.match(/className="text-xs text-gray-500 font-mono ([^"]*)"/);
    assert.ok(m, "URL span not found");
    for (const cls of ["flex-1", "min-w-0", "truncate"]) {
      assert.ok(m![1].split(/\s+/).includes(cls), `URL span lost ${cls}`);
    }
  });

  test("the action cluster is unchanged and still one horizontal group", () => {
    assert.match(row, /className="flex items-center gap-2 flex-shrink-0"/);
    for (const key of ["viewProductTitle", "editProductTitle", "deleteProductTitle"]) {
      assert.ok(row.includes(key), `${key} lost from the action cluster`);
    }
  });

  test("the responsive fix changed no URL, status or gate behaviour", () => {
    // Layout classes only. Every B-2 behaviour assertion above still applies;
    // this re-pins the three that a layout refactor could plausibly disturb.
    assert.match(row, /productUrl\(shop\.slug, product\.slug\)/);
    assert.match(row, /productLinkStatusKey\(productLinkStatus\(product\)\)/);
    assert.match(row, /!product\.hasFile && \(/);
    assert.ok(!/window\s*\.\s*location/.test(row), "row now reads window.location");
  });
});
