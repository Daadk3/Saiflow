/**
 * Stage D2 — the inspection policy, and what the surfaces link to.
 *
 * Route behaviour is proved by executing the real handlers in
 * tests/stage-d2-routes.test.ts. This file covers the decision table those
 * handlers consult, and the source-level facts about the UI that no runtime
 * test reaches.
 *
 * The policy tests here execute real code. The surface tests are source
 * assertions, and are limited to a question source text can actually answer:
 * "does this page still link a private deliverable directly?"
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { DeliverableGateReason } from "../lib/file-safety.ts";
import {
  inspectDecision,
  inspectProduct,
  INSPECT_TTL_SECONDS,
  type InspectAudience,
} from "../lib/inspect.ts";
import {
  MIN_DELIVERY_TTL_SECONDS,
  MAX_DELIVERY_TTL_SECONDS,
} from "../lib/storage/provider.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const adminRoute = read("../app/api/admin/inspect/[productId]/route.ts");
const sellerRoute = read("../app/api/products/[id]/inspect/route.ts");
const policySrc = read("../lib/inspect.ts");
const routes: [string, string][] = [
  ["admin", adminRoute],
  ["seller", sellerRoute],
];

/** Every state the predicate can currently produce. */
const ALL_REASONS: DeliverableGateReason[] = [
  "safe",
  "missing_file_key",
  "pending_scan",
  "scan_error",
  "unsafe",
  "scan_key_mismatch",
];

const AUDIENCES: InspectAudience[] = ["admin", "shop_member"];

/* ------------------------------------------------------------------ */
/* The admin table                                                      */
/* ------------------------------------------------------------------ */

describe("policy: the founder may moderate, but not open a rejected file", () => {
  test("SAFE is permitted, and marked verified", () => {
    assert.deepEqual(inspectDecision("safe", "admin"), {
      allow: true,
      verification: "verified",
    });
  });

  for (const reason of [
    "pending_scan",
    "scan_error",
    "scan_key_mismatch",
  ] as DeliverableGateReason[]) {
    test(`${reason} is permitted, and marked UNVERIFIED`, () => {
      // Permitted because moderation cannot happen behind a door the
      // moderator may not open — and explicitly not a claim of safety.
      assert.deepEqual(inspectDecision(reason, "admin"), {
        allow: true,
        verification: "unverified",
      });
    });
  }

  test("UNSAFE is refused, with no way to proceed", () => {
    const d = inspectDecision("unsafe", "admin");
    assert.equal(d.allow, false);
    assert.equal(d.allow === false && d.code, "unsafe");
    assert.equal(d.allow === false && d.status, 403);
  });

  test("a missing file key is refused", () => {
    const d = inspectDecision("missing_file_key", "admin");
    assert.equal(d.allow, false);
    assert.equal(d.allow === false && d.code, "no_file");
    assert.equal(d.allow === false && d.status, 404);
  });
});

/* ------------------------------------------------------------------ */
/* The seller table                                                     */
/* ------------------------------------------------------------------ */

describe("policy: a seller may retrieve only verified bytes", () => {
  test("SAFE is permitted, and marked verified", () => {
    assert.deepEqual(inspectDecision("safe", "shop_member"), {
      allow: true,
      verification: "verified",
    });
  });

  for (const reason of [
    "pending_scan",
    "scan_error",
    "scan_key_mismatch",
  ] as DeliverableGateReason[]) {
    test(`${reason} is REFUSED — a signed URL is a bearer credential`, () => {
      // The quarantine property: SaiFlow must not mint a transferable URL
      // over bytes that have never passed scanning, even for the shop that
      // uploaded them. The seller still holds the original.
      const d = inspectDecision(reason, "shop_member");
      assert.equal(d.allow, false, `${reason} must not be retrievable`);
      assert.equal(d.allow === false && d.code, "unverified");
      assert.equal(d.allow === false && d.status, 409);
    });
  }

  test("UNSAFE is refused", () => {
    const d = inspectDecision("unsafe", "shop_member");
    assert.equal(d.allow, false);
    assert.equal(d.allow === false && d.code, "unsafe");
  });

  test("a missing file key is refused", () => {
    assert.equal(inspectDecision("missing_file_key", "shop_member").allow, false);
  });

  test("SAFE is the ONLY state a seller may open", () => {
    const permitted = ALL_REASONS.filter(
      (r) => inspectDecision(r, "shop_member").allow
    );
    assert.deepEqual(permitted, ["safe"], "seller policy must be safe-only");
  });

  test("nothing a seller may open is ever unverified", () => {
    for (const reason of ALL_REASONS) {
      const d = inspectDecision(reason, "shop_member");
      if (d.allow) assert.equal(d.verification, "verified");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Fail-closed: the property M1 was about                              */
/* ------------------------------------------------------------------ */

describe("policy: unknown and future states refuse", () => {
  // Genuinely unknown values, not a known member cast to look unknown. An
  // earlier version of this suite cast "unsafe" and proved nothing; these are
  // strings the table has no row for, which is the real risk — a scan state
  // added by a later migration reaching a build that predates it.
  const UNKNOWN = [
    "quarantined",
    "SAFE",
    "Safe",
    "safe ",
    "",
    "pending",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
  ];

  for (const audience of AUDIENCES) {
    for (const unknown of UNKNOWN) {
      test(`${audience}: "${unknown}" is refused`, () => {
        const d = inspectDecision(unknown as DeliverableGateReason, audience);
        assert.equal(d.allow, false, `"${unknown}" must not be permitted`);
        assert.equal(d.allow === false && d.code, "unknown_state");
      });
    }
  }

  test("an unknown AUDIENCE also refuses", () => {
    const d = inspectDecision("safe", "moderator" as InspectAudience);
    assert.equal(d.allow, false);
    assert.equal(d.allow === false && d.code, "unknown_state");
  });

  test("prototype keys cannot be reached through the table", () => {
    // A lookup like table[reason] would otherwise find Object.prototype
    // members and treat a truthy function as a decision.
    for (const key of ["__proto__", "constructor", "toString", "valueOf"]) {
      for (const audience of AUDIENCES) {
        const d = inspectDecision(key as DeliverableGateReason, audience);
        assert.equal(d.allow, false, `${key} leaked a permission`);
      }
    }
  });

  test("the policy is a lookup table, not a computed fallthrough", () => {
    // The shape is the guarantee: a state is openable only because a row
    // says so. A trailing `return { allow: true }` would reintroduce M1.
    assert.ok(/const POLICY: Record<\s*InspectAudience/.test(policySrc));
    assert.ok(
      !/return\s*\{\s*allow:\s*true\s*\}/.test(policySrc),
      "no inline permission may be constructed outside the table"
    );
    const fn = policySrc.slice(policySrc.indexOf("export function inspectDecision"));
    assert.ok(
      !/allow:\s*true/.test(fn),
      "inspectDecision must not manufacture a permission"
    );
    assert.ok(
      (fn.match(/REFUSE_UNKNOWN/g) ?? []).length >= 2,
      "every lookup must be guarded"
    );
    assert.ok(
      (fn.match(/Object\.hasOwn\(/g) ?? []).length === 2,
      "both lookups must be own-property checks, not plain indexing"
    );
  });
});

describe("policy: total across the cross-product", () => {
  test("every audience and state yields a well-formed decision", () => {
    let checked = 0;
    let permitted = 0;
    for (const audience of AUDIENCES) {
      for (const reason of ALL_REASONS) {
        const d = inspectDecision(reason, audience);
        if (d.allow) {
          assert.ok(["verified", "unverified"].includes(d.verification));
          permitted++;
        } else {
          assert.ok(
            ["no_file", "unsafe", "unverified", "unknown_state"].includes(d.code)
          );
          assert.ok(d.status >= 400 && d.status < 500);
        }
        checked++;
      }
    }
    assert.equal(checked, 12, "the full cross-product must be exercised");
    // 4 admin allows + 1 seller allow. Pinned so a widening of either table
    // has to be a deliberate edit to this number.
    assert.equal(permitted, 5, "exactly five permissions may exist");
  });

  test("the decision is stable — no hidden input", () => {
    for (const audience of AUDIENCES) {
      for (const reason of ALL_REASONS) {
        assert.deepEqual(
          inspectDecision(reason, audience),
          inspectDecision(reason, audience)
        );
      }
    }
  });
});

describe("no unsafe-inspection override survives anywhere", () => {
  test("the policy module exposes no consent parser", () => {
    assert.ok(!/Acknowledge|acknowledge/i.test(policySrc));
    assert.ok(!/override/i.test(policySrc.replace(/no override/gi, "")));
  });

  test("neither route reads a consent parameter", () => {
    for (const [name, src] of routes) {
      assert.ok(
        !/searchParams/.test(src),
        `${name} must not read any query parameter`
      );
      assert.ok(
        !/new URL\(req\.url\)/.test(src),
        `${name} must not parse the request URL for inputs`
      );
    }
  });

  test("both routes decide through the single entry point", () => {
    for (const [name, src] of routes) {
      assert.ok(
        /inspectProduct\(product, "(admin|shop_member)"\)/.test(src),
        `${name} must pass only the row and the audience`
      );
      assert.ok(
        !/deliverableGateReason\(/.test(src),
        `${name} must not bypass the raw-status check by calling the predicate directly`
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* The raw status is checked before the predicate collapses it          */
/* ------------------------------------------------------------------ */

describe("inspectProduct refuses a status this build does not know", () => {
  const row = (fileScanStatus: string) => ({
    fileKey: "abc123XY_key-one",
    fileScanStatus: fileScanStatus as never,
    fileScanKey: "abc123XY_key-one",
  });

  // This is the case a source-level test could never have found, and a runtime
  // test did. `deliverableGateReason` maps an unrecognised status to
  // `scan_error` — correct for a sellability gate, where every non-SAFE answer
  // refuses alike. Inspection is different: the founder MAY open a scan_error
  // file, so an unknown status would have inherited that permission.
  for (const unknown of ["QUARANTINED", "REVOKED", "safe", "", "PENDING"]) {
    for (const audience of AUDIENCES) {
      test(`${audience}: raw status "${unknown}" is refused`, () => {
        const { decision, reason } = inspectProduct(row(unknown), audience);
        assert.equal(decision.allow, false, `"${unknown}" must not be openable`);
        assert.equal(decision.allow === false && decision.code, "unknown_state");
        assert.equal(reason, "unknown_status");
      });
    }
  }

  test("the four real statuses are still handled normally", () => {
    for (const status of ["PENDING_SCAN", "SAFE", "UNSAFE", "SCAN_ERROR"]) {
      const { reason } = inspectProduct(row(status), "admin");
      assert.notEqual(reason, "unknown_status", `${status} must be recognised`);
    }
  });

  test("SAFE still reaches a permission through the entry point", () => {
    const { decision } = inspectProduct(row("SAFE"), "shop_member");
    assert.deepEqual(decision, { allow: true, verification: "verified" });
  });

  test("the known-status set matches the Prisma enum exactly", () => {
    // If a migration adds a FileScanStatus value, this fails — which is the
    // point. Someone then has to decide what each audience may do with it.
    const schema = read("../prisma/schema.prisma");
    const block = schema.slice(
      schema.indexOf("enum FileScanStatus"),
      schema.indexOf("}", schema.indexOf("enum FileScanStatus"))
    );
    const declared = block
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => /^[A-Z_]+$/.test(l));

    assert.deepEqual(
      declared.sort(),
      ["PENDING_SCAN", "SAFE", "SCAN_ERROR", "UNSAFE"],
      "the schema enum changed — the inspection policy must be revisited"
    );
    for (const status of declared) {
      assert.ok(
        policySrc.includes(`"${status}"`),
        `${status} must appear in KNOWN_SCAN_STATUSES`
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* TTL                                                                  */
/* ------------------------------------------------------------------ */

describe("the inspection TTL sits inside the reviewed D1 policy", () => {
  test("60 seconds, and within the D1 bounds", () => {
    assert.equal(INSPECT_TTL_SECONDS, 60);
    assert.ok(INSPECT_TTL_SECONDS >= MIN_DELIVERY_TTL_SECONDS);
    assert.ok(INSPECT_TTL_SECONDS <= MAX_DELIVERY_TTL_SECONDS);
  });

  test("both routes request that TTL explicitly", () => {
    for (const [name, src] of routes) {
      assert.ok(/ttlSeconds: INSPECT_TTL_SECONDS/.test(src), name);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The broken direct links are gone                                     */
/* ------------------------------------------------------------------ */

describe("no surface links a private deliverable directly", () => {
  const surfaces: [string, string][] = [
    ["moderation queue", "../app/dashboard/moderation/page.tsx"],
    ["products directory", "../app/dashboard/admin/products/page.tsx"],
    ["review button", "../components/admin/ReviewButton.tsx"],
    [
      "seller edit page",
      "../app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
    ],
  ];

  for (const [name, path] of surfaces) {
    test(`${name} no longer hrefs a deliverable URL`, () => {
      const src = read(path);
      assert.ok(!/href=\{p\.fileUrl\}/.test(src), `${name}: href={p.fileUrl}`);
      assert.ok(!/href=\{fileUrl\}/.test(src), `${name}: href={fileUrl}`);
      assert.ok(!/href=\{product\.fileUrl\}/.test(src), `${name}: product.fileUrl`);
    });
  }

  test("the moderation queue points at the admin route", () => {
    const src = read("../app/dashboard/moderation/page.tsx");
    assert.ok(src.includes("href={`/api/admin/inspect/${p.id}`}"));
    assert.ok(src.includes("{p.canInspect && ("), "gated on canInspect");
    assert.ok(!/fileUrl/.test(src), "no fileUrl left in the queue at all");
  });

  test("the moderation API stops sending the URL", () => {
    const api = read("../app/api/admin/moderation/route.ts");
    assert.ok(!/fileUrl: true/.test(api), "fileUrl must not be selected");
    assert.ok(/fileKey: true/.test(api));
    assert.ok(/canInspect: fileKey != null/.test(api));
  });

  test("the seller edit page points at the seller route", () => {
    const src = read(
      "../app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx"
    );
    assert.ok(src.includes("href={`/api/products/${product.id}/inspect`}"));
    assert.ok(src.includes("product && fileUrl === product.fileUrl &&"));
  });

  test("the edit form still round-trips fileUrl through the save path", () => {
    const src = read(
      "../app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx"
    );
    assert.ok(src.includes("fileUrl: fileUrl || null"), "save payload intact");
    assert.ok(src.includes("setFileUrl(productData.fileUrl"), "load intact");
  });
});

/* ------------------------------------------------------------------ */
/* D2 changed nothing it was not supposed to                            */
/* ------------------------------------------------------------------ */

describe("D2 stays inside its scope", () => {
  test("checkout carries no inspection or delivery machinery", () => {
    // D3 has since added the sale gate to this route, so the old assertion
    // that it was ungated no longer applies. What remains D2's business is
    // that inspection never leaked into the purchase path: checkout must not
    // mint a signed URL, read bytes, or consult the inspection policy.
    const src = read("../app/api/checkout/route.ts");
    assert.ok(!src.includes("createDeliveryUrl"), "no delivery in checkout");
    assert.ok(!src.includes("readPrivateObject"), "no byte reads in checkout");
    assert.ok(!src.includes("inspectProduct"), "no inspection policy in checkout");
    assert.ok(!src.includes("inspectDecision"), "no inspection policy in checkout");
  });

  test("buyer download carries no inspection machinery", () => {
    // D4 has since gated this route and given it its own signed delivery, so
    // the old assertion that it was ungated no longer applies. What remains
    // D2's business is that the INSPECTION policy never leaked into the buyer
    // path: a buyer is authorised by purchase, never by audience.
    const src = read("../app/api/download/[productId]/route.ts");
    assert.ok(src.includes("Not authorized to download this product"));
    assert.ok(!src.includes("inspectProduct"), "no inspection policy in delivery");
    assert.ok(!src.includes("inspectDecision"), "no inspection policy in delivery");
    assert.ok(!src.includes("isAdminEmail"), "delivery is not an admin surface");
  });

  test("the D1 primitives are unmodified", () => {
    const provider = read("../lib/storage/provider.ts");
    const safety = read("../lib/file-safety.ts");
    assert.ok(provider.includes("export async function readPrivateObject("));
    assert.ok(provider.includes("return { ok: true, bytes: buffer };"));
    assert.ok(provider.includes("export const DEFAULT_DELIVERY_TTL_SECONDS = 60;"));
    assert.ok(provider.includes("export const MAX_DELIVERY_TTL_SECONDS = 300;"));
    assert.ok(safety.includes("export function isDeliverableSafe("));
    assert.ok(safety.includes("export function deliverableGateReason("));
  });

  test("no scanner file is touched by D2", () => {
    for (const f of [
      "../lib/scan/run.ts",
      "../lib/scan/policy.ts",
      "../lib/scan/cloudmersive.ts",
      "../lib/scan/archive.ts",
    ]) {
      assert.ok(!read(f).includes("createDeliveryUrl"), `${f} must not deliver`);
      assert.ok(!read(f).includes("inspectDecision"), `${f} must not inspect`);
    }
  });

  test("inspection is never exposed on a public surface", () => {
    for (const f of [
      "../app/page.tsx",
      "../app/browse/page.tsx",
      "../app/shop/[slug]/page.tsx",
      "../app/shop/[slug]/product/[productSlug]/page.tsx",
    ]) {
      const src = read(f);
      assert.ok(!src.includes("/api/admin/inspect/"), `${f}: admin inspection`);
      assert.ok(!src.includes("/inspect"), `${f}: any inspection route`);
    }
  });

  test("no migration was added by D2", () => {
    // The unsafe-inspection flow would have needed a ModerationAction enum
    // value. D2 ships no such flow, and therefore no schema change.
    const schema = read("../prisma/schema.prisma");
    assert.ok(!/INSPECTED/.test(schema), "no INSPECTED enum value");
    assert.ok(!/RESCAN_REQUESTED/.test(schema), "no rescan enum value");
  });
});
