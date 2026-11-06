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
import { Prisma } from "@prisma/client";
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

/**
 * An approved or rejected product must not commit a new extra-file set
 * unless the same transaction returns it to review. Otherwise a kit of
 * already-scanned files would be on sale before anyone looked at it, or
 * would stay on sale if the review write failed afterwards.
 */
export function extrasCommitWithReopen(input: {
  extrasChanged: boolean;
  moderationStatus: string;
  shopActive: boolean;
}): boolean {
  return (
    input.extrasChanged &&
    input.shopActive &&
    (input.moderationStatus === "APPROVED" || input.moderationStatus === "REJECTED")
  );
}

/** Same keys, order ignored. Used to decide whether a save must return to review. */
export function sameKeySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const b = new Set(right);
  return left.every((key) => b.has(key));
}

async function writeExtraRows(
  tx: Prisma.TransactionClient,
  productId: string,
  rows: readonly ExtraDeliverableWrite[]
): Promise<void> {
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
}

export async function replaceExtraDeliverables(
  productId: string,
  rows: readonly ExtraDeliverableWrite[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await writeExtraRows(tx, productId, rows);
  });
}

/**
 * Replace extras under a row lock on the product.
 *
 * If the product is approved or rejected when the lock is taken, the same
 * transaction returns it to review. A concurrent approval waits, then sees
 * PENDING. A suspended shop cannot reopen, so a decided product refuses the
 * write and keeps the previous kit. A pending product just stores the rows.
 */
export async function commitExtraDeliverables(input: {
  productId: string;
  rows: readonly ExtraDeliverableWrite[];
  actor: string;
  shopActive: boolean;
}): Promise<{ written: true; resubmitted: boolean } | { written: false }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${input.productId} FOR UPDATE`);
    const current = await tx.product.findUnique({
      where: { id: input.productId },
      select: { moderationStatus: true },
    });
    if (!current) return { written: false };
    const decided = current.moderationStatus === "APPROVED" || current.moderationStatus === "REJECTED";
    if (decided && !input.shopActive) return { written: false };
    await writeExtraRows(tx, input.productId, input.rows);
    if (!decided) return { written: true, resubmitted: false };
    const reopened = await tx.product.updateMany({
      where: { id: input.productId, moderationStatus: current.moderationStatus },
      data: { moderationStatus: "PENDING" },
    });
    if (reopened.count !== 1) throw new Error("deliverable-reopen-conflict");
    await tx.moderationEvent.create({
      data: {
        productId: input.productId,
        action: "RESUBMITTED",
        actor: input.actor,
        reason: current.moderationStatus === "APPROVED" ? "File replaced after approval" : null,
        previousStatus: current.moderationStatus,
        newStatus: "PENDING",
      },
    });
    return { written: true, resubmitted: true };
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
