/**
 * Creator file-safety UX.
 *
 * Two properties carry the weight here, and neither is about wording.
 *
 * 1. "ready" must mean exactly what the checkout and download gates mean.
 *    It is derived through `deliverableGateReason`, so the test that matters
 *    is the equivalence to `isDeliverableSafe` across every state, not a
 *    reading of the mapping.
 *
 * 2. The browser must not receive scan internals. The derivation moved to the
 *    server precisely so no key, hash, scan enum or deliverable URL travels in
 *    the payload, and the response shape is asserted field by field.
 *
 * No database and no network: the API's response shaping is exercised against
 * a mocked Prisma, and the derivation is a pure function.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isDeliverableSafe, type DeliverableSafety } from "../lib/file-safety";
import { creatorFileStatus } from "../lib/creator-file-status";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const en = JSON.parse(read("messages/en.json")).fileSafety;
const ar = JSON.parse(read("messages/ar.json")).fileSafety;

const KEY = "abc123XYZ_key-one";
const OTHER = "zzz999QQQ_key-two";
const STATUSES = ["PENDING_SCAN", "SAFE", "UNSAFE", "SCAN_ERROR"] as const;

/* ------------------------------------------------------------------ */
/* 1. "ready" means exactly what the gates mean                        */
/* ------------------------------------------------------------------ */

describe('"ready" is equivalent to isDeliverableSafe', () => {
  test("across every key and status combination", () => {
    let checked = 0;
    for (const fileKey of [null, KEY]) {
      for (const fileScanKey of [null, KEY, OTHER]) {
        for (const fileScanStatus of STATUSES) {
          const row = { fileKey, fileScanKey, fileScanStatus };
          assert.equal(
            creatorFileStatus(row) === "ready",
            isDeliverableSafe(row),
            `divergence at ${JSON.stringify(row)}`
          );
          checked++;
        }
      }
    }
    assert.equal(checked, 24);
  });

  test("only SAFE with a matching key is ready", () => {
    assert.equal(
      creatorFileStatus({ fileKey: KEY, fileScanKey: KEY, fileScanStatus: "SAFE" }),
      "ready"
    );
  });

  test("a stale SAFE verdict for a replaced file is NEVER ready", () => {
    // The trap fileScanKey exists to catch: SAFE, but for bytes that are gone.
    for (const fileScanKey of [OTHER, null]) {
      const status = creatorFileStatus({
        fileKey: KEY,
        fileScanKey,
        fileScanStatus: "SAFE",
      });
      assert.notEqual(status, "ready", JSON.stringify({ fileScanKey }));
      assert.equal(status, "checking");
    }
  });
});

describe("each state maps to one creator-facing status", () => {
  /**
   * The cast is the point of several tests below, not a convenience: they feed
   * statuses the enum does not contain, to prove an unrecognised value fails
   * closed rather than falling through to "ready". A migration could add one,
   * and TypeScript would not be there at runtime to stop it.
   */
  const row = (fileScanStatus: string, fileScanKey: string | null = KEY) =>
    ({ fileKey: KEY, fileScanKey, fileScanStatus } as unknown as DeliverableSafety);

  test("PENDING_SCAN -> checking", () => {
    assert.equal(creatorFileStatus(row("PENDING_SCAN", null)), "checking");
  });

  test("SCAN_ERROR -> needs_attention", () => {
    assert.equal(creatorFileStatus(row("SCAN_ERROR")), "needs_attention");
  });

  test("UNSAFE -> blocked", () => {
    assert.equal(creatorFileStatus(row("UNSAFE")), "blocked");
  });

  test("no file -> no badge", () => {
    for (const fileScanStatus of STATUSES) {
      assert.equal(
        creatorFileStatus({ fileKey: null, fileScanKey: null, fileScanStatus }),
        null
      );
    }
  });

  test("an unknown status fails closed, never ready", () => {
    for (const s of ["WEIRD_NEW_STATE", "", "safe", "Safe", "PENDING"]) {
      const status = creatorFileStatus(row(s));
      assert.notEqual(status, "ready", s);
      assert.equal(status, "needs_attention", s);
    }
  });

  test("no state outside the fixed enum is ever produced", () => {
    const allowed = new Set(["ready", "checking", "needs_attention", "blocked", null]);
    for (const fileKey of [null, KEY]) {
      for (const fileScanKey of [null, KEY, OTHER]) {
        for (const fileScanStatus of [...STATUSES, "SOMETHING_ELSE"]) {
          const probe = {
            fileKey,
            fileScanKey,
            fileScanStatus,
          } as unknown as DeliverableSafety;
          assert.ok(
            allowed.has(creatorFileStatus(probe)),
            JSON.stringify({ fileKey, fileScanKey, fileScanStatus })
          );
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. The payload carries no internals                                 */
/* ------------------------------------------------------------------ */

const SECRET_KEY = "SHOULD_NEVER_REACH_BROWSER_key";
const SECRET_URL = "https://utfs.io/f/SHOULD_NEVER_REACH_BROWSER";
const SECRET_SHA = "d0f1SHOULD_NEVER_REACH_BROWSER";

const state = { session: null as unknown, shop: null as unknown };

let GET: (req: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;

before(async () => {
  mock.module("next-auth", {
    namedExports: { getServerSession: async () => state.session },
  });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, {
    namedExports: { authOptions: {} },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        shop: { findUnique: async () => state.shop },
        product: { fields: { fileKey: { _toFieldRef: "Product.fileKey" } } },
      },
    },
  });
  GET = (await import("../app/api/shops/[slug]/route.ts")).GET as typeof GET;
});

function shopRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "shop_1",
    name: "Daad's Store",
    slug: "daad-s-store",
    description: null,
    logo: null,
    coverImage: null,
    createdAt: new Date("2026-01-01"),
    products: [
      {
        id: "p1",
        name: "Dodo",
        slug: "dodo",
        description: "A product",
        price: 25,
        currency: "SAR",
        thumbnailUrl: null,
        moderationStatus: "APPROVED",
        createdAt: new Date("2026-01-02"),
        fileUrl: SECRET_URL,
        fileKey: SECRET_KEY,
        fileScanStatus: "SAFE",
        fileScanKey: SECRET_KEY,
        fileScanSha256: SECRET_SHA,
      },
    ],
    shopUsers: [{ user: { email: "owner@saiflow.test" } }],
    ...overrides,
  };
}

const call = () =>
  GET(new Request("https://saiflow.test/api/shops/daad-s-store"), {
    params: Promise.resolve({ slug: "daad-s-store" }),
  });

beforeEach(() => {
  state.session = { user: { email: "owner@saiflow.test" } };
  state.shop = shopRow();
});

describe("the response carries a status, not the scan columns", () => {
  test("no internal field appears anywhere in the payload", async () => {
    const body = await (await call()).text();
    for (const leak of [
      SECRET_KEY, SECRET_URL, SECRET_SHA,
      "fileKey", "fileScanKey", "fileScanStatus", "fileScanSha256",
      "fileScanAttempts", "scanReason", "cloudmersive", "utfs.io",
    ]) {
      assert.ok(!body.includes(leak), `leaked: ${leak}`);
    }
  });

  test("the product exposes exactly the intended fields", async () => {
    const body = await (await call()).json();
    assert.deepEqual(
      Object.keys(body.products[0]).sort(),
      ["createdAt","currency","description","fileSafety","hasFile","id",
       "moderationStatus","name","price","slug","thumbnailUrl"]
    );
  });

  test("the derived status is present and correct", async () => {
    const body = await (await call()).json();
    assert.equal(body.products[0].fileSafety, "ready");
    assert.equal(body.products[0].hasFile, true);
  });

  test("co-members' email addresses are not returned", async () => {
    const body = await (await call()).text();
    assert.ok(!body.includes("shopUsers"));
    assert.ok(!body.includes("owner@saiflow.test"));
  });

  test("every scan state produces the right status over the wire", async () => {
    const expected: [string, string | null, string | null][] = [
      ["SAFE", SECRET_KEY, "ready"],
      ["SAFE", "other-key", "checking"],
      ["PENDING_SCAN", null, "checking"],
      ["SCAN_ERROR", SECRET_KEY, "needs_attention"],
      ["UNSAFE", SECRET_KEY, "blocked"],
    ];
    for (const [fileScanStatus, fileScanKey, want] of expected) {
      const row = shopRow();
      Object.assign(row.products[0], { fileScanStatus, fileScanKey });
      state.shop = row;
      const body = await (await call()).json();
      assert.equal(body.products[0].fileSafety, want, fileScanStatus);
    }
  });

  test("a product with no file reports no status but still says hasFile:false", async () => {
    const row = shopRow();
    Object.assign(row.products[0], { fileUrl: null, fileKey: null, fileScanKey: null });
    state.shop = row;
    const body = await (await call()).json();
    assert.equal(body.products[0].fileSafety, null);
    assert.equal(body.products[0].hasFile, false);
  });

  test("LEGACY row — fileUrl present, fileKey null — reports hasFile:false", async () => {
    // The real shape of the eight legacy products, and the reason hasFile is
    // keyed on fileKey rather than fileUrl. Deriving it from fileUrl answered
    // "was there once a file?" and so hid the dashboard's "upload a file"
    // warning from precisely the creators who needed to act on it.
    const row = shopRow();
    Object.assign(row.products[0], {
      fileUrl: SECRET_URL,        // legacy public URL, still populated
      fileKey: null,              // never migrated to a keyed upload
      fileScanKey: null,
      fileScanStatus: "PENDING_SCAN",
    });
    state.shop = row;

    const res = await call();
    const body = await res.json();

    assert.equal(body.products[0].hasFile, false, "the missing-file UX must render");
    assert.equal(body.products[0].fileSafety, null, "no safety badge for a fileless row");
    assert.notEqual(body.products[0].fileSafety, "ready");
  });

  test("a legacy row leaks neither its URL nor any key", async () => {
    const row = shopRow();
    Object.assign(row.products[0], { fileUrl: SECRET_URL, fileKey: null, fileScanKey: null });
    state.shop = row;
    const text = await (await call()).text();
    for (const leak of [SECRET_URL, "utfs.io", "fileUrl", "fileKey"]) {
      assert.ok(!text.includes(leak), `leaked: ${leak}`);
    }
  });

  test("a legacy row can NEVER be ready, whatever its scan columns say", async () => {
    // Belt and braces: even a stray SAFE verdict on a keyless row must not
    // produce ready, because isDeliverableSafe requires fileKey !== null.
    for (const fileScanStatus of ["PENDING_SCAN", "SAFE", "UNSAFE", "SCAN_ERROR"]) {
      const row = shopRow();
      Object.assign(row.products[0], {
        fileUrl: SECRET_URL,
        fileKey: null,
        fileScanKey: "some-old-key",
        fileScanStatus,
      });
      state.shop = row;
      const body = await (await call()).json();
      assert.equal(body.products[0].hasFile, false, fileScanStatus);
      assert.notEqual(body.products[0].fileSafety, "ready", fileScanStatus);
    }
  });

  test("a current keyed product still reports hasFile:true and can be ready", async () => {
    // The non-regression half: the fix must not hide the file on real products.
    const body = await (await call()).json();
    assert.equal(body.products[0].hasFile, true);
    assert.equal(body.products[0].fileSafety, "ready");
  });

  test("hasFile tracks fileKey, not fileUrl, across the four combinations", async () => {
    const cases: [string | null, string | null, boolean][] = [
      [SECRET_URL, SECRET_KEY, true],   // current product
      [SECRET_URL, null, false],        // legacy
      [null, SECRET_KEY, true],         // keyed, no legacy URL
      [null, null, false],              // nothing attached
    ];
    for (const [fileUrl, fileKey, want] of cases) {
      const row = shopRow();
      Object.assign(row.products[0], {
        fileUrl,
        fileKey,
        fileScanKey: fileKey,
        fileScanStatus: "SAFE",
      });
      state.shop = row;
      const body = await (await call()).json();
      assert.equal(
        body.products[0].hasFile,
        want,
        `fileUrl=${fileUrl ? "set" : "null"} fileKey=${fileKey ? "set" : "null"}`
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Authorisation and isolation                                      */
/* ------------------------------------------------------------------ */

describe("only a member of the shop may read its creator status", () => {
  test("anonymous is refused with 401 and no body", async () => {
    state.session = null;
    const res = await call();
    assert.equal(res.status, 401);
    const body = await res.text();
    assert.ok(!body.includes("fileSafety"));
    assert.ok(!body.includes(SECRET_KEY));
  });

  test("a signed-in NON-member is refused with 403", async () => {
    state.session = { user: { email: "someone-else@example.test" } };
    const res = await call();
    assert.equal(res.status, 403);
  });

  test("a non-member learns nothing about the shop's products", async () => {
    state.session = { user: { email: "someone-else@example.test" } };
    const body = await (await call()).text();
    for (const leak of [SECRET_KEY, SECRET_URL, "Dodo", "fileSafety", "ready"]) {
      assert.ok(!body.includes(leak), `leaked to non-member: ${leak}`);
    }
  });

  test("membership comparison is unchanged from main (exact match)", async () => {
    // Deliberately NOT relaxed. Elsewhere the codebase matches emails
    // case-insensitively, so exact matching here is arguably inconsistent —
    // but widening an authorisation check is not something to slip into a UX
    // change, and a differing-case pair would be two distinct User rows.
    // Recorded as an observation, not fixed here.
    const src = readFileSync(resolve(ROOT, "app/api/shops/[slug]/route.ts"), "utf8");
    assert.ok(/su\.user\.email === session\.user\?\.email/.test(src));
    state.session = { user: { email: "OWNER@SAIFLOW.TEST" } };
    assert.equal((await call()).status, 403, "case-mismatch is refused, as before");
  });

  test("a missing shop is 404 and reveals nothing", async () => {
    state.shop = null;
    const res = await call();
    assert.equal(res.status, 404);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Copy                                                             */
/* ------------------------------------------------------------------ */

describe("creator copy says what to do, not how the scanner works", () => {
  const all = [...Object.values(en), ...Object.values(ar)] as string[];

  test("no scan enum, vendor or internal identifier is rendered", () => {
    const words = ["cloudmersive","virus","malware","scanner","antivirus","hash","sha256","فيروس","برمجيات ضارة"];
    const tokens = ["PENDING_SCAN","SAFE","UNSAFE","SCAN_ERROR","fileKey","fileScanKey","fileScanStatus"];
    for (const s of all) {
      for (const w of words) assert.ok(!s.toLowerCase().includes(w.toLowerCase()), `${w} in: ${s}`);
      for (const t of tokens) assert.ok(!new RegExp(`\\b${t}\\b`).test(s), `${t} in: ${s}`);
    }
  });

  test('"automatically" never appears in either language', () => {
    for (const s of all) {
      assert.ok(!/automatic/i.test(s));
      assert.ok(!/تلقائي/.test(s));
    }
  });

  test("no guaranteed completion time is promised", () => {
    for (const s of all) {
      assert.ok(!/within \d/i.test(s));
      assert.ok(!/guarantee/i.test(s));
      assert.ok(!/خلال \d/.test(s));
    }
  });

  test("the failure copy tells the creator what to do", () => {
    assert.ok(/replace the file/i.test(en.blockedBody));
    assert.ok(/replace the file/i.test(en.needsAttentionBody));
    assert.ok(en.blocked.length > 0 && en.needsAttention.length > 0);
    assert.ok(ar.blockedBody.includes("استبدل"));
    assert.ok(ar.needsAttentionBody.includes("استبدل"));
  });

  test("the needs-attention copy does not tell the creator to wait", () => {
    // It previously said "try again later", which a creator cannot act on:
    // there is no manual retry, and once MAX_SCAN_ATTEMPTS is spent waiting
    // achieves nothing. Replacing the file is the only action that starts a
    // new check, so that is what the copy has to lead with.
    for (const s of [en.needsAttentionBody, en.needsAttention]) {
      assert.ok(!/later/i.test(s), `promises waiting: ${s}`);
      assert.ok(!/wait/i.test(s), `promises waiting: ${s}`);
      assert.ok(!/check back/i.test(s), `promises waiting: ${s}`);
    }
    for (const s of [ar.needsAttentionBody, ar.needsAttention]) {
      assert.ok(!s.includes("لاحقًا"), `promises waiting: ${s}`);
      assert.ok(!s.includes("لاحقاً"), `promises waiting: ${s}`);
      assert.ok(!s.includes("انتظر"), `promises waiting: ${s}`);
    }
  });

  test("neither failure state implies the product is sellable", () => {
    for (const s of [en.needsAttentionBody, en.blockedBody, ar.needsAttentionBody, ar.blockedBody]) {
      for (const w of ["ready", "verified", "for sale", "جاهز", "تم التحقق"]) {
        assert.ok(!s.toLowerCase().includes(w.toLowerCase()), `implies sellable: ${s}`);
      }
    }
  });

  test("ready, checking, blocked and moderation copy are untouched by L-A", () => {
    assert.equal(en.ready, "File verified \u2014 Ready");
    assert.equal(en.checking, "File safety check in progress");
    assert.equal(
      en.blockedBody,
      "This file didn\u2019t pass the required safety checks. Replace the file before publishing this product."
    );
    const moderation = JSON.parse(read("messages/en.json")).moderation;
    assert.equal(moderation.pendingBadge, "Under review");
  });

  test("the copy does not accuse the creator", () => {
    for (const s of all) {
      for (const w of ["you uploaded a virus","illegal","violation","انتهاك","مخالف"]) {
        assert.ok(!s.toLowerCase().includes(w.toLowerCase()), `accusatory: ${s}`);
      }
    }
  });

  test("both locales define exactly the same keys, none empty", () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
    for (const s of all) assert.ok(s.trim().length > 0);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Wiring and non-regression                                        */
/* ------------------------------------------------------------------ */

describe("the dashboard renders the server value and nothing else", () => {
  const page = strip(read("app/dashboard/shop/[slug]/page.tsx"));

  test("it does not derive safety client-side", () => {
    assert.ok(!/creatorFileStatus\(/.test(page), "no client-side derivation");
    assert.ok(/import type \{ CreatorFileStatus \}/.test(page), "type-only import");
  });

  test("no scan column or deliverable URL is read in the browser", () => {
    for (const f of ["fileUrl","fileKey","fileScanStatus","fileScanKey","fileScanSha256"]) {
      assert.ok(!new RegExp(`product\\.${f}\\b`).test(page), `reads ${f}`);
    }
  });

  test("all four states render from messages", () => {
    for (const s of ["ready","checking","needs_attention","blocked"]) {
      assert.ok(page.includes(`product.fileSafety === "${s}"`), `missing ${s}`);
    }
    for (const k of ["ready","checking","needsAttention","blocked","needsAttentionBody","blockedBody"]) {
      assert.ok(page.includes(`tFileSafety("${k}")`), `unused key ${k}`);
    }
  });

  test("the moderation badge stays independent of file safety", () => {
    assert.ok(page.includes('product.moderationStatus === "PENDING"'));
    assert.ok(page.includes('tModeration("pendingBadge")'));
  });
});

describe("no gate was touched", () => {
  test("checkout and download still refuse on isDeliverableSafe", () => {
    for (const f of ["app/api/checkout/route.ts", "app/api/download/[productId]/route.ts"]) {
      assert.ok(/if \(!isDeliverableSafe\(product\)\)/.test(strip(read(f))), f);
    }
  });

  test("the E2 storefront gate is intact on all five surfaces", () => {
    for (const f of ["app/page.tsx","app/browse/page.tsx","app/shop/[slug]/page.tsx",
                     "app/shop/[slug]/product/[productSlug]/page.tsx","app/sitemap.ts"]) {
      assert.ok(strip(read(f)).includes("...SAFE_DELIVERABLE_WHERE"), f);
    }
  });

  test("PRE_LAUNCH_MODE still defaults closed", () => {
    const env = strip(read("lib/env.ts"));
    assert.ok(/\.default\("true"\)/.test(env));
    assert.ok(/v !== "false"/.test(env));
  });

  test("the canonical predicate is unedited", () => {
    const fs = strip(read("lib/file-safety.ts"));
    assert.ok(/product\.fileKey !== null/.test(fs));
    assert.ok(/product\.fileScanStatus === "SAFE"/.test(fs));
    assert.ok(/product\.fileScanKey === product\.fileKey/.test(fs));
  });
});
