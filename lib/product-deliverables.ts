/**
 * Extra private files sold with a product's primary file.
 *
 * Product.fileKey stays the primary deliverable. This module never replaces
 * that column and never bundles files into a ZIP. An empty list is every
 * product that exists today: one file, the gates already in place.
 *
 * A product with extras is sellable and downloadable only when the primary
 * file is safe AND every extra is safe for its own key. One unscanned or
 * unsafe attachment refuses the whole kit. Nothing here is a scanner bypass.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  attachedScanFields,
  isDeliverableSafe,
  verifyDeliverableProvenance,
  type DeliverableSafety,
} from "@/lib/file-safety";
import { extractOwnAssetKey } from "@/lib/validations";

/** Primary file plus extras. Eight is the cap so a kit cannot fan out scans without bound. */
export const MAX_PRODUCT_FILES = 8;

export function extrasAreSafe(extras: DeliverableSafety[] | null | undefined): boolean {
  if (!extras || extras.length === 0) return true;
  return extras.every((row) => isDeliverableSafe(row));
}

/**
 * Database form of "no extra is short of SAFE for its own key".
 * Zero rows match, so a single-file product still passes.
 */
/**
 * Column reference for `fileScanKey = fileKey` on an extra row.
 * A test double that only stubs Product still loads: the fallback is only a
 * stand-in so import does not throw. The generated client supplies the real
 * field reference.
 */
function extraFileKeyRef(): unknown {
  const model = (prisma as { productDeliverable?: { fields?: { fileKey?: unknown } } }).productDeliverable;
  return model?.fields?.fileKey ?? { _toFieldRef: "ProductDeliverable.fileKey" };
}

export function unsafeExtraFilter(): Prisma.ProductDeliverableWhereInput {
  return {
    OR: [
      { fileScanStatus: { not: "SAFE" } },
      { fileScanKey: null },
      { NOT: { fileScanKey: { equals: extraFileKeyRef() as never } } },
    ],
  };
}

export function noUnsafeExtrasWhere(): Prisma.ProductWhereInput {
  return { deliverables: { none: unsafeExtraFilter() } };
}

export interface ExtraDeliverableWrite {
  fileUrl: string;
  fileKey: string;
  name: string;
  fileScanStatus: DeliverableSafety["fileScanStatus"];
  fileScanKey: string | null;
  fileScanSha256: string | null;
  fileScanAt: Date | null;
}

/** Same keys, order ignored. Used to decide whether a save must return to review. */
export function sameKeySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const b = new Set(right);
  return left.every((key) => b.has(key));
}

export async function replaceExtraDeliverables(
  productId: string,
  rows: readonly ExtraDeliverableWrite[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.productDeliverable.deleteMany({ where: { productId } });
    if (rows.length === 0) return;
    await tx.productDeliverable.createMany({
      data: rows.map((row, index) => ({
        productId,
        position: index + 1,
        fileUrl: row.fileUrl,
        fileKey: row.fileKey,
        name: row.name,
        fileScanStatus: row.fileScanStatus,
        fileScanKey: row.fileScanKey,
        fileScanSha256: row.fileScanSha256,
        fileScanAt: row.fileScanAt,
      })),
    });
  });
}

/**
 * Turn seller-supplied extra URLs into rows that may be stored.
 * `undefined` means the client did not send the field: leave existing extras.
 * A list replaces them. The primary key cannot be repeated.
 */
export async function resolveExtraDeliverables(
  shopId: string,
  fileUrls: unknown,
  primaryKey: string
): Promise<
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; rows: ExtraDeliverableWrite[] }
  | { ok: false; error: string }
> {
  if (fileUrls === undefined) return { ok: true, skipped: true };
  if (!Array.isArray(fileUrls)) return { ok: false, error: "Invalid file list" };
  if (fileUrls.length > MAX_PRODUCT_FILES - 1) {
    return { ok: false, error: `A product can have at most ${MAX_PRODUCT_FILES} files` };
  }
  const seen = new Set<string>([primaryKey]);
  const rows: ExtraDeliverableWrite[] = [];
  for (const url of fileUrls) {
    if (typeof url !== "string" || url.length === 0) return { ok: false, error: "Invalid file URL" };
    const key = extractOwnAssetKey(url);
    if (!key) return { ok: false, error: "Invalid file URL" };
    if (seen.has(key)) return { ok: false, error: "Each file can be attached once" };
    seen.add(key);
    const provenance = await verifyDeliverableProvenance(key, shopId);
    if (!provenance.ok) return { ok: false, error: "This file cannot be attached to a product." };
    const asset = await prisma.fileAsset.findUnique({ where: { key }, select: { name: true } });
    const scan = attachedScanFields(provenance.asset);
    rows.push({
      fileUrl: url,
      fileKey: key,
      name: (asset?.name || "file").slice(0, 200),
      fileScanStatus: scan.fileScanStatus,
      fileScanKey: scan.fileScanKey,
      fileScanSha256: scan.fileScanSha256,
      fileScanAt: scan.fileScanAt,
    });
  }
  return { ok: true, skipped: false, rows };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
