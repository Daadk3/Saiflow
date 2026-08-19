/**
 * Stage E3 — admin moderation UX.
 *
 * Three properties carry the weight, and none of them is about wording.
 *
 * 1. The preview is not a storefront. It renders products the public gate
 *    deliberately hides, so it must sell nothing, expose no deliverable, and
 *    be reachable only by a marketplace admin.
 *
 * 2. The public gate is untouched. Widening what a moderator can see must not
 *    widen what a buyer can see, so Stage E2's `SAFE_DELIVERABLE_WHERE` is
 *    re-asserted on every storefront surface here.
 *
 * 3. Moderation and file safety stay independent. Approve and reject remain
 *    available in every scan state; what the new status changes is what the
 *    moderator is TOLD, not what they are allowed to do.
 *
 * Plus the legacy `hasFile` correction: the admin surfaces used to answer
 * "does this product have a file?" from `fileUrl`, the pre-Stage-B column that
 * is populated on exactly the products that have no storage key.
 *
 * No database and no network. Prisma is mocked; the derivations are pure.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isDeliverableSafe, type DeliverableSafety } from "../lib/file-safety";
import { moderatorFileSafety } from "../lib/moderator-file-status";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Comments describe the traps; they must never satisfy an assertion. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const PREVIEW_PAGE = "app/dashboard/admin/products/[id]/preview/page.tsx";

const KEY = "abc123XYZ_key-one";
const OTHER = "zzz999QQQ_key-two";
const STATUSES = ["PENDING_SCAN", "SAFE", "UNSAFE", "SCAN_ERROR"] as const;
const REASONS = [
  "safe",
  "pending_scan",
  "scan_error",
  "unsafe",
  "scan_key_mismatch",
  "missing_file_key",
] as const;

/* ================================================================== */
/* 1. The moderator mapping                                            */
/* ================================================================== */

describe("all six canonical reasons survive, one for one", () => {
  test("every reason is reachable from a real row", () => {
    const seen = new Set<string>();
    for (const fileKey of [null, KEY]) {
      for (const fileScanKey of [null, KEY, OTHER]) {
        for (const fileScanStatus of STATUSES) {
          seen.add(
            moderatorFileSafety({ fileKey, fileScanKey, fileScanStatus }).reason
          );
        }
      }
    }
    assert.deepEqual([...seen].sort(), [...REASONS].sort());
  });

  test("no reason outside the canonical six is ever produced", () => {
    const allowed = new Set<string>(REASONS);
    for (const fileKey of [null, KEY]) {
      for (const fileScanKey of [null, KEY, OTHER]) {
        for (const s of [...STATUSES, "SOMETHING_NEW", "", "safe"]) {
          const probe = {
            fileKey,
            fileScanKey,
            fileScanStatus: s,
          } as unknown as DeliverableSafety;
          assert.ok(
            allowed.has(moderatorFileSafety(probe).reason),
            JSON.stringify({ fileKey, fileScanKey, fileScanStatus: s })
          );
        }
      }
    }
  });

  test("each reason maps to exactly one tone, and only safe is ok", () => {
    const row = (fileScanStatus: string, fileScanKey: string | null = KEY) =>
      ({ fileKey: KEY, fileScanKey, fileScanStatus } as unknown as DeliverableSafety);

    assert.equal(moderatorFileSafety(row("SAFE")).tone, "ok");
    assert.equal(moderatorFileSafety(row("PENDING_SCAN", null)).tone, "waiting");
    assert.equal(moderatorFileSafety(row("SAFE", OTHER)).tone, "waiting");
    assert.equal(moderatorFileSafety(row("SCAN_ERROR")).tone, "attention");
    assert.equal(moderatorFileSafety(row("UNSAFE")).tone, "blocked");
    assert.equal(
      moderatorFileSafety({
        fileKey: null,
        fileScanKey: null,
        fileScanStatus: "SAFE",
      }).tone,
      "attention"
    );
  });
});

describe('"publishable" means exactly what the public gate means', () => {
  test("equivalent to isDeliverableSafe across every state", () => {
    let checked = 0;
    for (const fileKey of [null, KEY]) {
      for (const fileScanKey of [null, KEY, OTHER]) {
        for (const fileScanStatus of STATUSES) {
          const row = { fileKey, fileScanKey, fileScanStatus };
          assert.equal(
            moderatorFileSafety(row).publishable,
            isDeliverableSafe(row),
            `divergence at ${JSON.stringify(row)}`
          );
          checked++;
        }
      }
    }
    assert.equal(checked, 24);
  });

  test("a stale SAFE verdict for a replaced file is never publishable", () => {
    for (const fileScanKey of [OTHER, null]) {
      const v = moderatorFileSafety({
        fileKey: KEY,
        fileScanKey,
        fileScanStatus: "SAFE",
      });
      assert.equal(v.publishable, false, JSON.stringify({ fileScanKey }));
      assert.equal(v.reason, "scan_key_mismatch");
    }
  });

  test("an unrecognised scan status fails closed", () => {
    for (const s of ["WEIRD_NEW_STATE", "", "safe", "Safe", "PENDING"]) {
      const v = moderatorFileSafety({
        fileKey: KEY,
        fileScanKey: KEY,
        fileScanStatus: s,
      } as unknown as DeliverableSafety);
      assert.equal(v.publishable, false, s);
      assert.equal(v.reason, "scan_error", s);
    }
  });
});

describe("no second safety predicate exists", () => {
  const src = strip(read("lib/moderator-file-status.ts"));

  test("the reason comes from deliverableGateReason and nowhere else", () => {
    assert.ok(src.includes("deliverableGateReason(product)"));
  });

  test("it never reads a scan column itself", () => {
    for (const col of ["fileKey", "fileScanStatus", "fileScanKey"]) {
      assert.ok(
        !new RegExp(`product\\.${col}\\b`).test(src),
        `re-reads ${col}`
      );
    }
  });

  test("it compares against no scan enum literal", () => {
    for (const token of ["SAFE", "UNSAFE", "PENDING_SCAN", "SCAN_ERROR"]) {
      assert.ok(
        !new RegExp(`\\b${token}\\b`).test(src),
        `restates ${token}`
      );
    }
  });
});

/* ================================================================== */
/* 2. The preview page, as source                                      */
/* ================================================================== */

describe("the preview cannot sell anything", () => {
  const src = strip(read(PREVIEW_PAGE));

  test("no BuyButton is mounted", () => {
    assert.ok(!/BuyButton/.test(src));
  });

  test("no checkout endpoint is referenced", () => {
    assert.ok(!/checkout/i.test(src));
  });

  test("no purchase or download API is referenced", () => {
    for (const p of ["/api/checkout", "/api/orders", "/api/download"]) {
      assert.ok(!src.includes(p), p);
    }
  });

  test("every link the page renders is admin-internal", () => {
    // Import specifiers are not links, so only href values are inspected —
    // the page legitimately imports @/app/api/auth/authOptions to run its own
    // authorization check.
    const hrefs = (src.match(/href=(?:\{`[^`]*`\}|"[^"]*")/g) ?? []).map((h) =>
      h.replace(/^href=\{?`?"?/, "").replace(/`?"?\}?$/, "")
    );
    assert.deepEqual(new Set(hrefs), new Set([
      "/dashboard/admin/products",
      "/api/admin/inspect/${productId}",
    ]));
    for (const h of hrefs) {
      if (h.startsWith("/api/")) {
        assert.equal(h, "/api/admin/inspect/${productId}", h);
      }
    }
  });
});

describe("the preview exposes no file, storage or scan internals", () => {
  const src = strip(read(PREVIEW_PAGE));

  test("no file column identifier appears anywhere in the page", () => {
    for (const token of [
      "fileUrl",
      "fileKey",
      "fileScanStatus",
      "fileScanKey",
      "fileScanSha256",
      "fileScanAttempts",
      "scanReason",
      "scanSha256",
    ]) {
      assert.ok(!src.includes(token), `page mentions ${token}`);
    }
  });

  test("it does not query Prisma directly", () => {
    assert.ok(!/\bprisma\b/.test(src));
  });

  test("no storage host or signing helper is referenced", () => {
    for (const token of ["utfs.io", "uploadthing", "createDeliveryUrl", "cloudmersive"]) {
      assert.ok(!src.toLowerCase().includes(token.toLowerCase()), token);
    }
  });
});

describe("the preview is admin-only and never indexable", () => {
  const raw = read(PREVIEW_PAGE);
  const src = strip(raw);

  test("it lives under the admin authorization boundary", () => {
    // The layout redirects non-admins for the whole segment; the path IS the
    // inherited guarantee, so it is asserted rather than assumed.
    assert.ok(PREVIEW_PAGE.startsWith("app/dashboard/admin/"));
    assert.ok(strip(read("app/dashboard/admin/layout.tsx")).includes("isAdminEmail"));
  });

  test("it re-checks admin authorization itself", () => {
    assert.ok(src.includes("getServerSession(authOptions)"));
    assert.ok(src.includes("isAdminEmail(session.user.email)"));
    assert.ok(src.includes('redirect("/login")'));
    assert.ok(src.includes('redirect("/dashboard")'));
  });

  test("the session check precedes the product lookup", () => {
    assert.ok(
      src.indexOf("isAdminEmail") < src.indexOf("getAdminProductPreview"),
      "authorization must run before any product is read"
    );
  });

  test("it is force-dynamic and noindex", () => {
    assert.ok(src.includes('export const dynamic = "force-dynamic"'));
    assert.ok(/robots:\s*\{\s*index:\s*false/.test(src));
    assert.ok(/nocache:\s*true/.test(src));
  });
});

/* ================================================================== */
/* 3. The public E2 gate is unchanged                                  */
/* ================================================================== */

describe("Stage E2 storefront gate survives E3 untouched", () => {
  const SURFACES = [
    "app/page.tsx",
    "app/browse/page.tsx",
    "app/shop/[slug]/page.tsx",
    "app/shop/[slug]/product/[productSlug]/page.tsx",
    "app/sitemap.ts",
  ];

  for (const surface of SURFACES) {
    test(`${surface} still applies SAFE_DELIVERABLE_WHERE`, () => {
      const src = strip(read(surface));
      assert.ok(src.includes("SAFE_DELIVERABLE_WHERE"), surface);
      assert.ok(src.includes("...SAFE_DELIVERABLE_WHERE"), surface);
    });
  }

  test("the buyer product page still requires APPROVED moderation", () => {
    const src = strip(read("app/shop/[slug]/product/[productSlug]/page.tsx"));
    assert.ok(src.includes('moderationStatus: "APPROVED"'));
    assert.ok(src.includes("isActive: true"));
  });

  test("the safety authority itself is byte-for-byte unmodified", () => {
    const src = read("lib/file-safety.ts");
    assert.ok(src.includes("product.fileKey !== null &&"));
    assert.ok(src.includes('product.fileScanStatus === "SAFE" &&'));
    assert.ok(src.includes("product.fileScanKey === product.fileKey"));
    assert.ok(src.includes("fileScanKey: { equals: prisma.product.fields.fileKey }"));
  });

  test("no admin module is imported by a public surface", () => {
    for (const surface of SURFACES) {
      const src = strip(read(surface));
      for (const m of [
        "admin-product-preview",
        "moderator-file-status",
        "admin-stats",
      ]) {
        assert.ok(!src.includes(m), `${surface} imports ${m}`);
      }
    }
  });
});

/* ================================================================== */
/* 4. Moderation stays independent of file safety                      */
/* ================================================================== */

describe("approve and reject remain available in every state", () => {
  const src = strip(read("components/admin/ReviewButton.tsx"));

  test("neither button is disabled by a safety value", () => {
    // `busy` is the in-flight guard and the ONLY disable condition.
    const disables = src.match(/disabled=\{[^}]*\}/g) ?? [];
    assert.ok(disables.length > 0);
    for (const d of disables) {
      assert.equal(d, "disabled={busy}", `unexpected disable condition: ${d}`);
    }
  });

  test("the control knows nothing about file safety at all", () => {
    for (const token of [
      "fileSafety",
      "publishable",
      "deliverableGateReason",
      "moderatorFileSafety",
      "fileKey",
      "fileScanStatus",
    ]) {
      assert.ok(!src.includes(token), `ReviewButton references ${token}`);
    }
  });

  test("it still posts to the existing moderation endpoint", () => {
    assert.ok(src.includes("/api/admin/moderation/${productId}"));
  });
});

describe('the "open" control points at the preview, not the storefront', () => {
  test("ReviewButton takes previewHref and no publicHref", () => {
    const src = strip(read("components/admin/ReviewButton.tsx"));
    assert.ok(src.includes("previewHref"));
    assert.ok(!src.includes("publicHref"));
    assert.ok(src.includes("href={previewHref}"));
  });

  test("the directory supplies the admin preview path", () => {
    const src = strip(read("app/dashboard/admin/products/page.tsx"));
    const hrefs = src.match(/previewHref=\{`[^`]+`\}/g) ?? [];
    assert.equal(hrefs.length, 2, "desktop table and mobile cards");
    for (const h of hrefs) {
      assert.equal(h, "previewHref={`/dashboard/admin/products/${p.id}/preview`}");
    }
    assert.ok(!/\/shop\/\$\{p\.shopSlug\}\/product\//.test(src));
  });

  test("the overview's missing-file list no longer links to the storefront", () => {
    const src = strip(read("app/dashboard/admin/page.tsx"));
    assert.ok(!/\/shop\/\$\{p\.shopSlug\}\/product\//.test(src));
    assert.ok(src.includes("/dashboard/admin/products/${p.id}/preview"));
  });
});

/* ================================================================== */
/* 5. Copy exists in both languages                                    */
/* ================================================================== */

describe("moderator copy is complete in Arabic and English", () => {
  const en = JSON.parse(read("messages/en.json"));
  const ar = JSON.parse(read("messages/ar.json"));

  const flat = (o: Record<string, unknown>, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object"
        ? flat(v as Record<string, unknown>, p ? `${p}.${k}` : k)
        : [p ? `${p}.${k}` : k]
    );

  test("every canonical reason has a label in both files", () => {
    for (const reason of REASONS) {
      for (const [name, m] of [["en", en], ["ar", ar]] as const) {
        const label = (m.admin.fileSafety.reason as Record<string, string>)[reason];
        assert.equal(typeof label, "string", `${name}: ${reason}`);
        assert.ok(label.trim().length > 0, `${name}: ${reason} is blank`);
      }
    }
  });

  test("the non-publishable warning exists and states the consequence", () => {
    assert.match(en.admin.fileSafety.notPublishable, /does not put this product on sale/i);
    assert.ok(ar.admin.fileSafety.notPublishable.includes("لا يضع هذا المنتج للبيع"));
  });

  test("the whole message set is key-for-key identical", () => {
    assert.deepEqual(flat(en).sort(), flat(ar).sort());
  });

  test("no Arabic label is left in English", () => {
    for (const v of Object.values(
      ar.admin.fileSafety.reason as Record<string, string>
    )) {
      assert.ok(/[؀-ۿ]/.test(v), `not translated: ${v}`);
    }
    for (const v of Object.values(ar.admin.preview as Record<string, string>)) {
      assert.ok(/[؀-ۿ]/.test(v), `not translated: ${v}`);
    }
  });
});

/* ================================================================== */
/* 6. Runtime behaviour against a mocked Prisma                        */
/* ================================================================== */

const LEGACY_URL = "https://utfs.io/f/SHOULD_NEVER_REACH_BROWSER";
const SECRET_KEY = "SHOULD_NEVER_REACH_BROWSER_key";
const SECRET_SHA = "d0f1SHOULD_NEVER_REACH_BROWSER";

const calls = {
  findUnique: null as Record<string, unknown> | null,
  findMany: [] as Record<string, unknown>[],
};
const state = { product: null as unknown, directoryRows: [] as unknown[] };

let getAdminProductPreview: (id: string) => Promise<Record<string, unknown> | null>;
let getProductsDirectory: (o: Record<string, unknown>) => Promise<{
  rows: Record<string, unknown>[];
}>;
let getFounderStats: () => Promise<Record<string, unknown>>;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
        product: {
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
          count: async () => 0,
          findUnique: async (args: Record<string, unknown>) => {
            calls.findUnique = args;
            return state.product;
          },
          findMany: async (args: Record<string, unknown>) => {
            calls.findMany.push(args);
            return state.directoryRows;
          },
        },
        user: { count: async () => 0 },
        shop: { count: async () => 0 },
        shopUser: { findMany: async () => [] },
        moderationEvent: { count: async () => 0 },
        order: { count: async () => 0 },
      },
    },
  });

  // Double-cast: the real signatures return typed DTOs, and these tests
  // deliberately inspect them as bags of keys so an added field shows up as a
  // failure rather than being quietly accepted by the type.
  const preview = await import("../lib/admin-product-preview.ts");
  getAdminProductPreview =
    preview.getAdminProductPreview as unknown as typeof getAdminProductPreview;

  const stats = await import("../lib/admin-stats.ts");
  getProductsDirectory =
    stats.getProductsDirectory as unknown as typeof getProductsDirectory;
  getFounderStats = stats.getFounderStats as unknown as typeof getFounderStats;
});

beforeEach(() => {
  calls.findUnique = null;
  calls.findMany = [];
  state.product = null;
  state.directoryRows = [];
});

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_pending_1",
    name: "Zooz",
    slug: "zooz",
    description: "Awaiting review",
    price: 25,
    currency: "SAR",
    category: "Templates",
    images: [],
    thumbnailUrl: null,
    moderationStatus: "PENDING",
    isActive: true,
    createdAt: new Date("2026-01-02"),
    fileKey: SECRET_KEY,
    fileScanStatus: "PENDING_SCAN",
    fileScanKey: null,
    shop: { name: "Daad's Store", slug: "daad-s-store" },
    ...overrides,
  };
}

describe("a PENDING, unscanned product can be previewed", () => {
  test("it is returned rather than filtered away", async () => {
    state.product = productRow();
    const preview = await getAdminProductPreview("prod_pending_1");
    assert.ok(preview);
    assert.equal(preview.moderationStatus, "PENDING");
    assert.deepEqual(preview.fileSafety, {
      reason: "pending_scan",
      publishable: false,
      tone: "waiting",
    });
  });

  test("the lookup applies no moderation and no safety filter", async () => {
    state.product = productRow();
    await getAdminProductPreview("prod_pending_1");
    const where = calls.findUnique?.where as Record<string, unknown>;
    assert.deepEqual(Object.keys(where), ["id"]);
    assert.equal(where.id, "prod_pending_1");
  });

  test("an UNSAFE product is previewable but offers no inspection link", async () => {
    state.product = productRow({
      fileScanStatus: "UNSAFE",
      fileScanKey: SECRET_KEY,
    });
    const preview = await getAdminProductPreview("prod_pending_1");
    assert.equal((preview?.fileSafety as { reason: string }).reason, "unsafe");
    assert.equal(preview?.canInspect, false);
  });

  test("a SAFE product is inspectable and publishable", async () => {
    state.product = productRow({
      fileScanStatus: "SAFE",
      fileScanKey: SECRET_KEY,
    });
    const preview = await getAdminProductPreview("prod_pending_1");
    assert.equal(preview?.canInspect, true);
    assert.equal((preview?.fileSafety as { publishable: boolean }).publishable, true);
  });

  test("a missing product is null, not an empty shell", async () => {
    state.product = null;
    assert.equal(await getAdminProductPreview("nope"), null);
  });
});

describe("the preview payload carries no internals", () => {
  test("it exposes exactly the intended fields", async () => {
    state.product = productRow();
    const preview = await getAdminProductPreview("prod_pending_1");
    assert.deepEqual(Object.keys(preview!).sort(), [
      "canInspect",
      "category",
      "createdAt",
      "currency",
      "description",
      "fileSafety",
      "id",
      "images",
      "isActive",
      "moderationStatus",
      "name",
      "price",
      "shop",
      "slug",
      "thumbnailUrl",
    ]);
  });

  test("no key, URL or hash survives into the result", async () => {
    state.product = productRow({
      fileUrl: LEGACY_URL,
      fileScanSha256: SECRET_SHA,
    });
    const body = JSON.stringify(await getAdminProductPreview("prod_pending_1"));
    for (const leak of [
      SECRET_KEY,
      SECRET_SHA,
      LEGACY_URL,
      "fileUrl",
      "fileKey",
      "fileScanKey",
      "fileScanStatus",
      "fileScanSha256",
      "utfs.io",
    ]) {
      assert.ok(!body.includes(leak), `leaked: ${leak}`);
    }
  });

  test("a hostile or foreign image URL is dropped, not rendered", async () => {
    // The preview is the one surface that renders unmoderated seller input,
    // so the allowlist that guards storage is applied again on the way out.
    state.product = productRow({
      thumbnailUrl: "https://evil.example.com/f/abc",
      images: [
        "javascript:alert(1)",
        "http://utfs.io/f/plaintext",
        "https://utfs.io.evil.com/f/spoof",
        "https://utfs.io/f/legitimate",
      ],
    });
    const preview = await getAdminProductPreview("prod_pending_1");
    assert.equal(preview?.thumbnailUrl, null);
    assert.deepEqual(preview?.images, ["https://utfs.io/f/legitimate"]);
  });

  test("a storage-hosted thumbnail survives", async () => {
    state.product = productRow({ thumbnailUrl: "https://abc.ufs.sh/f/thumb" });
    const preview = await getAdminProductPreview("prod_pending_1");
    assert.equal(preview?.thumbnailUrl, "https://abc.ufs.sh/f/thumb");
  });

  test("the shop logo is neither selected nor returned", async () => {
    state.product = productRow();
    const preview = await getAdminProductPreview("prod_pending_1");
    assert.deepEqual(Object.keys(preview?.shop as object).sort(), ["name", "slug"]);
    const shopSelect = (
      (calls.findUnique?.select as Record<string, unknown>).shop as Record<string, unknown>
    ).select as Record<string, unknown>;
    assert.ok(!("logo" in shopSelect));
  });

  test("the query never selects the legacy URL column", async () => {
    state.product = productRow();
    await getAdminProductPreview("prod_pending_1");
    const select = calls.findUnique?.select as Record<string, unknown>;
    assert.ok(!("fileUrl" in select), "fileUrl must not be selected");
    assert.equal(select.fileKey, true);
    assert.equal(select.fileScanStatus, true);
    assert.equal(select.fileScanKey, true);
  });
});

/* ================================================================== */
/* 7. The legacy hasFile regression                                    */
/* ================================================================== */

function directoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_legacy_1",
    name: "Noor",
    slug: "noor",
    thumbnailUrl: null,
    price: 25,
    currency: "SAR",
    category: null,
    moderationStatus: "APPROVED",
    isActive: true,
    createdAt: new Date("2025-06-01"),
    fileKey: null,
    fileScanStatus: "PENDING_SCAN",
    fileScanKey: null,
    shop: { name: "Daad's Store", slug: "daad-s-store", shopUsers: [{ user: { name: "Daad" } }] },
    _count: { moderationEvents: 0 },
    moderationEvents: [],
    ...overrides,
  };
}

const directory = () =>
  getProductsDirectory({ filter: "all", sort: "createdAt", dir: "desc" });

describe("legacy rows never look like they have a scannable deliverable", () => {
  test("fileUrl set + fileKey null reports hasFile false", async () => {
    // The exact production shape: a pre-Stage-B product carrying a public URL
    // and no storage key. Under the old `fileUrl != null` test this reported
    // hasFile TRUE, which suppressed the "Missing file" warning on the only
    // products it existed for.
    state.directoryRows = [directoryRow({ fileUrl: LEGACY_URL, fileKey: null })];
    const { rows } = await directory();
    assert.equal(rows[0].hasFile, false);
  });

  test("it is reported as having no file attached, not as a scan failure", async () => {
    state.directoryRows = [directoryRow({ fileUrl: LEGACY_URL, fileKey: null })];
    const { rows } = await directory();
    assert.deepEqual(rows[0].fileSafety, {
      reason: "missing_file_key",
      publishable: false,
      tone: "attention",
    });
    assert.equal(rows[0].canInspect, false);
  });

  test("a real deliverable still reports hasFile true", async () => {
    state.directoryRows = [
      directoryRow({ fileKey: SECRET_KEY, fileScanStatus: "SAFE", fileScanKey: SECRET_KEY }),
    ];
    const { rows } = await directory();
    assert.equal(rows[0].hasFile, true);
    assert.equal((rows[0].fileSafety as { reason: string }).reason, "safe");
  });

  test("hasFile agrees with the canonical reason on every combination", async () => {
    for (const fileKey of [null, SECRET_KEY]) {
      for (const fileScanKey of [null, SECRET_KEY, OTHER]) {
        for (const fileScanStatus of STATUSES) {
          state.directoryRows = [
            directoryRow({ fileUrl: LEGACY_URL, fileKey, fileScanKey, fileScanStatus }),
          ];
          const { rows } = await directory();
          const reason = (rows[0].fileSafety as { reason: string }).reason;
          assert.equal(
            rows[0].hasFile,
            reason !== "missing_file_key",
            JSON.stringify({ fileKey, fileScanKey, fileScanStatus })
          );
        }
      }
    }
  });

  test("the directory query no longer selects the legacy URL column", async () => {
    state.directoryRows = [directoryRow()];
    await directory();
    const select = calls.findMany[0]?.select as Record<string, unknown>;
    assert.ok(!("fileUrl" in select), "fileUrl must not be selected");
    assert.equal(select.fileKey, true);
  });

  test("no directory row emits a scan column", async () => {
    state.directoryRows = [directoryRow({ fileUrl: LEGACY_URL, fileKey: SECRET_KEY })];
    const { rows } = await directory();
    const body = JSON.stringify(rows);
    for (const leak of [SECRET_KEY, LEGACY_URL, "fileUrl", "fileKey", "fileScanKey", "fileScanStatus"]) {
      assert.ok(!body.includes(leak), `leaked: ${leak}`);
    }
  });
});

describe("the overview's missing-file list keys on the storage key", () => {
  test("its query asks for fileKey null, not fileUrl null", async () => {
    state.directoryRows = [];
    await getFounderStats();
    const missing = calls.findMany.find(
      (a) => (a.where as Record<string, unknown>)?.moderationStatus === "APPROVED"
    );
    assert.ok(missing, "missing-file query not found");
    const where = missing.where as Record<string, unknown>;
    assert.ok("fileKey" in where, "must key on fileKey");
    assert.equal(where.fileKey, null);
    assert.ok(!("fileUrl" in where), "must not key on the legacy column");
  });
});
