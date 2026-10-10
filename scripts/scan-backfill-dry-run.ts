/**
 * Scan backfill — DRY RUN ONLY.
 *
 * Reports which products carry a deliverable that the scan worker can never
 * reach, and why. It answers three questions for one environment:
 *
 *   1. how many products have a downloadable file at all
 *   2. how many of those have no FileAsset row (uploaded before provenance
 *      existed, or attached by a legacy URL), so the worker never selects them
 *   3. how many DO have a row, and what state that row is in
 *
 * ZERO DATABASE WRITES. There is no --apply mode in this script by design:
 * the backfill itself is a separate, approved change. Every query below is a
 * read, and the test in tests/scan-backfill-dry-run.test.ts pins that no
 * write method is ever referenced here.
 *
 * Output names no seller, no file, no key and no URL: product ids are cut to
 * a prefix, and everything else is a count.
 *
 * Usage (pick the environment through DATABASE_URL, never by editing this):
 *   node --env-file=.env.local scripts/scan-backfill-dry-run.ts
 */

import { prisma } from "../lib/prisma";
import { MAX_SCAN_ATTEMPTS } from "../lib/scan/run";

const WINDOW_MS = 15 * 60_000;
const prefix = (id: string) => `${id.slice(0, 8)}…`;

export interface DryRunReport {
  productsWithFile: number;
  withKey: number;
  legacyUrlOnly: number;
  keyWithoutAsset: number;
  keyWithAsset: number;
  assetsByStatus: Record<string, number>;
  attemptsExhausted: number;
  stalePending: number;
  wouldNeedBackfill: number;
  samples: { missingAsset: string[]; legacyUrlOnly: string[] };
}

/** Pure aggregation over rows already read, so a test can run it on fixtures. */
export function summarise(
  products: { id: string; fileKey: string | null; fileUrl: string | null }[],
  assets: { key: string; scanStatus: string; scanAttempts: number; scanAt: Date | null }[],
  now: Date = new Date()
): DryRunReport {
  const byKey = new Map(assets.map((a) => [a.key, a]));
  const report: DryRunReport = {
    productsWithFile: products.length,
    withKey: 0,
    legacyUrlOnly: 0,
    keyWithoutAsset: 0,
    keyWithAsset: 0,
    assetsByStatus: {},
    attemptsExhausted: 0,
    stalePending: 0,
    wouldNeedBackfill: 0,
    samples: { missingAsset: [], legacyUrlOnly: [] },
  };
  for (const p of products) {
    if (p.fileKey === null) {
      report.legacyUrlOnly += 1;
      if (report.samples.legacyUrlOnly.length < 20) report.samples.legacyUrlOnly.push(prefix(p.id));
      continue;
    }
    report.withKey += 1;
    const asset = byKey.get(p.fileKey);
    if (!asset) {
      report.keyWithoutAsset += 1;
      if (report.samples.missingAsset.length < 20) report.samples.missingAsset.push(prefix(p.id));
      continue;
    }
    report.keyWithAsset += 1;
    report.assetsByStatus[asset.scanStatus] = (report.assetsByStatus[asset.scanStatus] ?? 0) + 1;
    if (asset.scanAttempts >= MAX_SCAN_ATTEMPTS && asset.scanStatus !== "SAFE" && asset.scanStatus !== "UNSAFE") {
      report.attemptsExhausted += 1;
    }
    if (
      asset.scanStatus === "PENDING_SCAN" &&
      (asset.scanAt === null || now.getTime() - asset.scanAt.getTime() > WINDOW_MS)
    ) {
      report.stalePending += 1;
    }
  }
  // A backfill can only create rows for keys we know; URL-only rows need a
  // different treatment (re-upload), and are counted separately.
  report.wouldNeedBackfill = report.keyWithoutAsset;
  return report;
}

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { OR: [{ fileKey: { not: null } }, { fileUrl: { not: null } }] },
    select: { id: true, fileKey: true, fileUrl: true },
  });
  const keys = products.map((p) => p.fileKey).filter((k): k is string => k !== null);
  const assets =
    keys.length === 0
      ? []
      : await prisma.fileAsset.findMany({
          where: { key: { in: keys } },
          select: { key: true, scanStatus: true, scanAttempts: true, scanAt: true },
        });

  const report = summarise(products, assets);
  console.log("SaiFlow scan backfill — DRY RUN (no writes)");
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\nSummary: ${report.productsWithFile} products with a file; ` +
      `${report.keyWithoutAsset} would need a FileAsset backfill; ` +
      `${report.legacyUrlOnly} carry only a legacy URL and need re-upload; ` +
      `${report.attemptsExhausted} exhausted their attempts; ${report.stalePending} pending beyond the window.`
  );
}

const isEntry = process.argv[1] !== undefined && /scan-backfill-dry-run\.ts$/.test(process.argv[1]);
if (isEntry) {
  main()
    .catch((error) => {
      console.error("dry run failed:", (error as Error)?.name);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
