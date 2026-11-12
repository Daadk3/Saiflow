/**
 * One definition of "a buyer can see and buy this" (lib/sellable).
 *
 * What must hold:
 * - isSellable and unsellableReason agree with each other and with
 *   isDeliverableSafe across every combination of active, approved, shop
 *   active and file state.
 * - SELLABLE_PRODUCT_WHERE is exactly those four conditions, the file part
 *   being SAFE_DELIVERABLE_WHERE itself.
 * - APPROVED_NOT_SELLABLE_WHERE selects approved, active products of active
 *   shops whose file is not safe, and its OR covers each way the safe
 *   clause can fail, including the NULL cases a NOT would drop.
 */
import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

const FIELD_REF = { _toFieldRef: "Product.fileKey" };

type Mod = typeof import("../lib/sellable.ts");
type Safety = typeof import("../lib/file-safety.ts");
let sellable: Mod;
let safety: Safety;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: { fields: { fileKey: FIELD_REF } },
        productDeliverable: { fields: { fileKey: { _toFieldRef: "ProductDeliverable.fileKey" } } },
      },
    },
  });
  // lib/file-safety's scan announcements import the notifier; never called here.
  mock.module("@/lib/notify", { namedExports: { notifyAdminsProductReadyForReview: async () => [] } });
  sellable = await import("../lib/sellable.ts");
  safety = await import("../lib/file-safety.ts");
});

const FILE_STATES = [
  { fileKey: "k1", fileScanStatus: "SAFE", fileScanKey: "k1" },
  { fileKey: "k1", fileScanStatus: "SAFE", fileScanKey: "k0" },
  { fileKey: "k1", fileScanStatus: "SAFE", fileScanKey: null },
  { fileKey: "k1", fileScanStatus: "PENDING_SCAN", fileScanKey: null },
  { fileKey: "k1", fileScanStatus: "SCAN_ERROR", fileScanKey: "k1" },
  { fileKey: "k1", fileScanStatus: "UNSAFE", fileScanKey: "k1" },
  { fileKey: null, fileScanStatus: "SAFE", fileScanKey: null },
  { fileKey: null, fileScanStatus: "PENDING_SCAN", fileScanKey: null },
] as const;

function* everyProduct() {
  for (const isActive of [true, false]) {
    for (const moderationStatus of ["APPROVED", "PENDING", "REJECTED"] as const) {
      for (const shopActive of [true, false]) {
        for (const salesEnabled of [true, false]) {
          for (const file of FILE_STATES) {
            yield {
              isActive,
              moderationStatus,
              shop: { isActive: shopActive, salesEnabled },
              ...file,
              // Explicit empty list: the relation was loaded and there are no extras.
              deliverables: [],
            } as Parameters<Mod["isSellable"]>[0];
          }
        }
      }
    }
  }
}

/** The where-clause, evaluated in memory the way Postgres would (NULL comparisons are not true). */
function matchesApprovedNotSellable(p: ReturnType<typeof everyProduct> extends Generator<infer T> ? T : never): boolean {
  // NOT (fileScanKey = fileKey) is true only when both keys are present and differ.
  const keysUnequalNonNull = p.fileKey !== null && p.fileScanKey !== null && p.fileKey !== p.fileScanKey;
  return (
    p.isActive &&
    p.moderationStatus === "APPROVED" &&
    p.shop.isActive &&
    p.shop.salesEnabled &&
    (p.fileKey === null || p.fileScanStatus !== "SAFE" || p.fileScanKey === null || keysUnequalNonNull)
  );
}

describe("isSellable and unsellableReason", () => {
  test("agree with each other and with isDeliverableSafe, across every combination", () => {
    let sellableCount = 0;
    for (const p of everyProduct()) {
      const expected =
        p.isActive &&
        p.moderationStatus === "APPROVED" &&
        p.shop.isActive &&
        p.shop.salesEnabled &&
        safety.isDeliverableSafe(p);
      assert.equal(sellable.isSellable(p), expected, JSON.stringify(p));
      assert.equal(sellable.unsellableReason(p) === "sellable", expected, JSON.stringify(p));
      if (expected) sellableCount++;
    }
    assert.equal(sellableCount, 1, "exactly one combination is sellable");
  });

  test("the reason names the first failing condition, then the file's own reason", () => {
    const ok = { isActive: true, moderationStatus: "APPROVED" as const, shop: { isActive: true, salesEnabled: true }, fileKey: "k", fileScanStatus: "SAFE" as const, fileScanKey: "k", deliverables: [] as [] };
    assert.equal(sellable.unsellableReason(ok), "sellable");
    assert.equal(sellable.unsellableReason({ ...ok, isActive: false, moderationStatus: "REJECTED" }), "inactive");
    assert.equal(sellable.unsellableReason({ ...ok, moderationStatus: "PENDING", shop: { isActive: false, salesEnabled: false } }), "not_approved");
    assert.equal(sellable.unsellableReason({ ...ok, shop: { isActive: false, salesEnabled: false }, fileKey: null }), "shop_inactive");
    assert.equal(sellable.unsellableReason({ ...ok, shop: { isActive: true, salesEnabled: false } }), "sales_disabled");
    assert.equal(sellable.unsellableReason({ ...ok, shop: { isActive: true, salesEnabled: false }, fileKey: null }), "sales_disabled");
    assert.equal(sellable.unsellableReason({ ...ok, fileKey: null, fileScanKey: null }), "missing_file_key");
    assert.equal(sellable.unsellableReason({ ...ok, fileScanStatus: "UNSAFE" }), "unsafe");
    assert.equal(sellable.unsellableReason({ ...ok, fileScanStatus: "PENDING_SCAN", fileScanKey: null }), "pending_scan");
    assert.equal(sellable.unsellableReason({ ...ok, fileScanKey: "old" }), "scan_key_mismatch");
    const { deliverables: _loaded, ...omitted } = ok;
    assert.equal(sellable.isSellable(omitted), false);
    assert.equal(
      sellable.isSellable({
        ...ok,
        deliverables: [{ fileKey: "e", fileScanStatus: "UNSAFE", fileScanKey: "e" }],
      }),
      false
    );
  });
});

describe("the where-clauses", () => {
  test("SELLABLE_PRODUCT_WHERE is the four conditions, with the canonical file clause", () => {
    // Condition 4 depends on what the product delivers: a FILE product needs
    // the canonical file clause, untouched; a HOSTED_ACCESS product needs its
    // private access record. Under AND, so a caller's own OR cannot replace it.
    assert.deepEqual(sellable.SELLABLE_PRODUCT_WHERE, {
      isActive: true,
      moderationStatus: "APPROVED",
      shop: { isActive: true, salesEnabled: true },
      AND: [
        {
          OR: [
            { deliveryType: "FILE", ...safety.SAFE_DELIVERABLE_WHERE },
            { deliveryType: "HOSTED_ACCESS", hostedAccess: { isNot: null }, deliverables: { none: {} } },
          ],
        },
        sellable.noUnsafeExtrasWhere(),
      ],
    });
    assert.deepEqual(safety.SAFE_DELIVERABLE_WHERE, {
      fileKey: { not: null },
      fileScanStatus: "SAFE",
      fileScanKey: { equals: FIELD_REF },
    });
  });

  test("APPROVED_NOT_SELLABLE_WHERE is an explicit OR, null-safe, never NOT over the safe clause", () => {
    const where = sellable.APPROVED_NOT_SELLABLE_WHERE as unknown as Record<string, unknown>;
    assert.equal(where.isActive, true);
    assert.equal(where.moderationStatus, "APPROVED");
    assert.deepEqual(where.shop, { isActive: true, salesEnabled: true });
    assert.deepEqual(where.OR, [
      { fileKey: null },
      { fileScanStatus: { not: "SAFE" } },
      { fileScanKey: null },
      { NOT: { fileScanKey: { equals: FIELD_REF } } },
      {
        deliverables: {
          some: {
            OR: [
              { fileScanStatus: { not: "SAFE" } },
              { fileScanKey: null },
              { NOT: { fileScanKey: { equals: { _toFieldRef: "ProductDeliverable.fileKey" } } } },
            ],
          },
        },
      },
    ]);
    assert.equal(where.NOT, undefined, "a top-level NOT would drop the fileless rows (SQL NULL)");
  });

  test("evaluated as Postgres would, it selects exactly the approved, active, active-shop products that are not sellable", () => {
    for (const p of everyProduct()) {
      const approvedActive = p.isActive && p.moderationStatus === "APPROVED" && p.shop.isActive && p.shop.salesEnabled;
      assert.equal(matchesApprovedNotSellable(p), approvedActive && !sellable.isSellable(p), JSON.stringify(p));
    }
  });
});
