/**
 * An extra file is a real deliverable. The worker must claim and scan it,
 * and the admin list must not call the kit verified while that extra is
 * still pending. The approve route stays strict; these tests do not loosen it.
 */
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { moderatorListingSafety } from "../lib/moderator-file-status.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const PDF = (() => {
  const bytes = new Uint8Array(16);
  bytes.set([0x25, 0x50, 0x44, 0x46]);
  return bytes;
})();

const CLEAN = {
  clean: true,
  verifiedFileFormat: ".pdf",
  containsExecutable: false,
  containsInvalidFile: false,
  containsScript: false,
  containsPasswordProtectedFile: false,
  containsRestrictedFileFormat: false,
  containsMacros: false,
  containsXmlExternalEntities: false,
  containsInsecureDeserialization: false,
  containsHtml: false,
  containsUnsafeArchive: false,
  containsOleEmbeddedObject: false,
  virusNames: [] as string[],
};

interface Extra {
  fileKey: string;
  shopId: string;
}

const db = {
  assetShopId: "shop_1",
  extras: [] as Extra[],
  order: [] as string[],
};

function asset() {
  return {
    key: "extra_key",
    shopId: db.assetShopId,
    route: "PRODUCT_FILE",
    name: "kit-en.xlsx",
    scanStatus: "PENDING_SCAN",
    scanAttempts: 0,
    scanAt: null,
    scanClaimToken: null,
    scanClaimedAt: null,
  };
}

let scanFileAsset: (
  key: string,
  opts?: { provider?: { id: string; isConfigured: () => boolean; scan: () => Promise<unknown> } }
) => Promise<{ key: string; outcome: string }>;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: {
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
          // This key is never the primary file.
          findFirst: async () => null,
          findMany: async () => [],
          updateMany: async () => ({ count: 0 }),
        },
        productDeliverable: {
          fields: { fileKey: { _toFieldRef: "ProductDeliverable.fileKey" } },
          findFirst: async (args: { where: { fileKey: string; product: { shopId: string } } }) => {
            const row = db.extras.find(
              (extra) => extra.fileKey === args.where.fileKey && extra.shopId === args.where.product.shopId
            );
            return row ? { id: "extra_1" } : null;
          },
          updateMany: async () => ({ count: 0 }),
        },
        fileAsset: {
          findUnique: async () => asset(),
          updateMany: async (args: { data: { scanClaimToken?: string } }) => {
            if (args.data.scanClaimToken) db.order.push("claim");
            return { count: 1 };
          },
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            fileAsset: { updateMany: async () => ({ count: 1 }) },
            product: {
              findMany: async () => [],
              updateMany: async () => ({ count: 0 }),
              fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
            },
            productDeliverable: {
              updateMany: async () => ({ count: 1 }),
              fields: { fileKey: { _toFieldRef: "ProductDeliverable.fileKey" } },
            },
            moderationEvent: { createMany: async () => ({ count: 0 }) },
          }),
      },
    },
  });
  mock.module("@/lib/storage/provider", {
    namedExports: {
      MAX_SCANNABLE_BYTES: 128 * 1024 * 1024,
      readPrivateObject: async () => ({ ok: true, bytes: PDF }),
    },
  });
  const realPolicy = await import("../lib/scan/policy.ts");
  mock.module(pathToFileURL(resolve(ROOT, "lib/scan/policy.ts")).href, {
    namedExports: { ...realPolicy, structuralVerdict: () => ({ outcome: "ALLOW" }) },
  });
  scanFileAsset = (await import("../lib/scan/run.ts")).scanFileAsset as typeof scanFileAsset;
});

const provider = () => ({
  id: "test",
  isConfigured: () => true,
  scan: async () => {
    db.order.push("scan");
    return { ok: true, findings: CLEAN };
  },
});

describe("an extra file is a deliverable the worker scans", () => {
  test("a same-shop extra is claimed and scanned", async () => {
    db.assetShopId = "shop_1";
    db.extras = [{ fileKey: "extra_key", shopId: "shop_1" }];
    db.order = [];
    const report = await scanFileAsset("extra_key", { provider: provider() });
    assert.equal(report.outcome, "SAFE");
    assert.deepEqual(db.order, ["claim", "scan"]);
  });

  test("a key used only by another shop is still skipped", async () => {
    db.assetShopId = "shop_1";
    db.extras = [{ fileKey: "extra_key", shopId: "shop_other" }];
    db.order = [];
    const report = await scanFileAsset("extra_key", { provider: provider() });
    assert.deepEqual(report, { key: "extra_key", outcome: "SKIPPED_NOT_ATTACHED" });
    assert.deepEqual(db.order, []);
  });

  test("a key attached to nothing is still skipped", async () => {
    db.assetShopId = "shop_1";
    db.extras = [];
    db.order = [];
    const report = await scanFileAsset("extra_key", { provider: provider() });
    assert.deepEqual(report, { key: "extra_key", outcome: "SKIPPED_NOT_ATTACHED" });
    assert.deepEqual(db.order, []);
  });
});

describe("the admin list does not call a half-checked kit verified", () => {
  const safe = { fileKey: "primary", fileScanStatus: "SAFE" as const, fileScanKey: "primary" };

  test("a pending extra keeps Approve disabled and the badge off verified", () => {
    const listed = moderatorListingSafety(safe, [
      { fileKey: "extra", fileScanStatus: "PENDING_SCAN", fileScanKey: null },
    ]);
    assert.equal(listed.reason, "pending_scan");
    assert.equal(listed.publishable, false);
    assert.equal(listed.tone, "waiting");
  });

  test("a safe primary with a safe extra stays verified", () => {
    const listed = moderatorListingSafety(safe, [
      { fileKey: "extra", fileScanStatus: "SAFE", fileScanKey: "extra" },
    ]);
    assert.equal(listed.reason, "safe");
    assert.equal(listed.publishable, true);
  });

  test("a caller that did not load extras still reports the primary", () => {
    assert.equal(moderatorListingSafety(safe, undefined).reason, "safe");
  });
});

describe("the stuck extra stays eligible for the existing cron", () => {
  test("the queue still selects a ProductDeliverable, and approval still requires every extra", () => {
    const run = read("lib/scan/run.ts");
    const queue = run.slice(run.indexOf("export async function findScannableKeys"));
    assert.ok(queue.includes('FROM "ProductDeliverable" d'));
    assert.ok(queue.includes('d."fileKey" = fa."key"'));
    assert.ok(queue.includes('p."shopId" = fa."shopId"'));
    assert.ok(queue.includes('fa."scanAttempts" <'));
    assert.ok(queue.includes('fa."scanAt" IS NULL'));
    const worker = run.slice(run.indexOf("export async function scanFileAsset"));
    assert.ok(worker.includes("productDeliverable?.findFirst"));
    assert.ok(worker.indexOf("SKIPPED_NOT_ATTACHED") < worker.indexOf("claimScan(key, now)"));

    const gate = read("app/api/admin/moderation/[productId]/route.ts");
    assert.ok(gate.includes("!isDeliverableSafe(product)"));
    assert.ok(gate.includes("!extrasAreSafe(product.deliverables)"));
  });
});
