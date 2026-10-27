import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeReviewChecks, type FileContentFacts } from "@/lib/review-checklist";

/**
 * Recompute and store a product's review-checklist auto-checks.
 *
 * Called after the seller's save (create and edit) and after the scan
 * settles the product's file. Reads the product's own title, description
 * and scan columns, plus the facts the scan stored on the FileAsset for the
 * product's CURRENT key, so a replaced file never borrows another's facts.
 *
 * Writes Product.reviewChecks and nothing else. It never touches
 * moderationStatus: the checklist flags, the founder decides.
 *
 * Never throws. A failure here leaves the previous result (or none) in
 * place, and the checklist shows "not checked yet" rather than a pass.
 */
export async function refreshReviewChecks(
  productId: string,
  db: Prisma.TransactionClient = prisma
): Promise<boolean> {
  try {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { name: true, description: true, fileKey: true, fileScanStatus: true, fileScanKey: true },
    });
    if (!product) return false;
    const asset = product.fileKey
      ? await db.fileAsset.findUnique({ where: { key: product.fileKey }, select: { contentFacts: true } })
      : null;
    const facts = (asset?.contentFacts ?? null) as FileContentFacts | null;
    const checks = computeReviewChecks({ ...product, facts });
    await db.product.updateMany({
      // Only if the file is still the one the facts were read for.
      where: { id: productId, fileKey: product.fileKey },
      data: { reviewChecks: checks as unknown as Prisma.InputJsonValue, reviewChecksAt: new Date(checks.computedAt) },
    });
    return true;
  } catch (error) {
    console.error("[review-checks] refresh failed", (error as Error)?.name);
    return false;
  }
}
