/**
 * The legacy backfill dry run reports and never writes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("scripts/scan-backfill-dry-run.ts", () => {
  const src = strip(read("../scripts/scan-backfill-dry-run.ts"));

  test("it contains no write, no apply mode and no raw SQL", () => {
    for (const verb of ["create", "update", "upsert", "delete", "executeRaw", "queryRaw", "--apply", "$transaction"]) {
      assert.ok(!src.includes(verb), `dry run must not mention ${verb}`);
    }
    assert.ok(/prisma\.product\.findMany/.test(src));
    assert.ok(/prisma\.fileAsset\.findMany/.test(src));
  });

  test("it prints counts and id prefixes, never keys or URLs", () => {
    assert.ok(/select: \{ id: true, fileKey: true, fileUrl: true \}/.test(src));
    assert.ok(!/console\.log\([^)]*fileUrl/.test(src));
    assert.ok(/id\.slice\(0, 8\)/.test(src));
  });

  test("the aggregation counts what a backfill would need", async () => {
    const { summarise } = await import("../scripts/scan-backfill-dry-run.ts");
    const now = new Date("2026-09-23T12:00:00Z");
    const old = new Date(now.getTime() - 60 * 60_000);
    const report = summarise(
      [
        { id: "prod_aaaa1111", fileKey: "k1", fileUrl: "u" },
        { id: "prod_bbbb2222", fileKey: "k2", fileUrl: "u" },
        { id: "prod_cccc3333", fileKey: null, fileUrl: "https://utfs.io/f/legacy" },
        { id: "prod_dddd4444", fileKey: "k4", fileUrl: "u" },
      ],
      [
        { key: "k1", scanStatus: "SAFE", scanAttempts: 1, scanAt: old },
        { key: "k4", scanStatus: "PENDING_SCAN", scanAttempts: 3, scanAt: old },
      ],
      now
    );
    assert.equal(report.productsWithFile, 4);
    assert.equal(report.withKey, 3);
    assert.equal(report.legacyUrlOnly, 1);
    assert.equal(report.keyWithoutAsset, 1);
    assert.equal(report.keyWithAsset, 2);
    assert.deepEqual(report.assetsByStatus, { SAFE: 1, PENDING_SCAN: 1 });
    assert.equal(report.attemptsExhausted, 1);
    assert.equal(report.stalePending, 1);
    assert.equal(report.wouldNeedBackfill, 1);
    assert.deepEqual(report.samples.missingAsset, ["prod_bbb" + "…"]);
    assert.deepEqual(report.samples.legacyUrlOnly, ["prod_ccc" + "…"]);
  });
});
