/**
 * The single definition of "this product's current deliverable has passed
 * scanning".
 *
 * It lives in one place because it will be consumed from at least three
 * separate gates — founder inspection, checkout, and buyer download — and each
 * one re-deriving it is an opportunity to get it subtly wrong.
 *
 * Nothing consumes it yet. The scanner arrives in Stage C; this exists first so
 * that when it does, the predicate is already fixed and tested.
 */

import type { FileScanStatus, Prisma, UploadRoute } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** The three columns the predicate reads. */
export interface DeliverableSafety {
  fileKey: string | null;
  fileScanStatus: FileScanStatus;
  fileScanKey: string | null;
}

/**
 * The ONLY correct way to ask whether the file currently attached to a product
 * has passed scanning.
 *
 * Two mistakes this exists to prevent:
 *
 * 1. Testing `fileScanStatus === "SAFE"` alone. The status describes whichever
 *    file `fileScanKey` names, which is not necessarily the file attached now.
 *
 * 2. Testing `fileScanKey === fileKey` without the null guard. In JavaScript
 *    `null === null` is TRUE, so a product carrying no file at all would
 *    satisfy the comparison. The `fileKey !== null` clause is what stops a
 *    fileless product from ever looking safe.
 */
export function isDeliverableSafe(product: DeliverableSafety): boolean {
  return (
    product.fileKey !== null &&
    product.fileScanStatus === "SAFE" &&
    product.fileScanKey === product.fileKey
  );
}

/**
 * Why a product's deliverable is not sellable — or that it is.
 *
 * `isDeliverableSafe` remains THE authority on the boolean question. This adds
 * nothing to that decision and may never be used in place of it: it exists so
 * a gate that has already refused can say something more useful than "no" to a
 * founder looking at a stuck product, and so refusals can be counted by cause.
 *
 * "safe" is returned under exactly the conditions `isDeliverableSafe` returns
 * true, and under no others. The two are separate functions rather than one
 * built on the other so that the reviewed predicate stays untouched — which
 * means they could in principle drift, and so tests/stage-d-delivery-gate
 * asserts their equivalence across the complete cross-product of states. That
 * test, not this comment, is what holds the two in agreement.
 */
export type DeliverableGateReason =
  | "safe"
  | "missing_file_key"
  | "pending_scan"
  | "scan_error"
  | "unsafe"
  | "scan_key_mismatch";

/**
 * Precedence is deliberate, and the order is the useful one rather than the
 * obvious one:
 *
 *   1. No file at all is reported first. With `fileKey` null the scan columns
 *      describe nothing that is attached, so any verdict they carry would be
 *      a statement about some other file.
 *
 *   2. Then the status. In particular a product mid-pipeline — file attached,
 *      `fileScanKey` still null, status PENDING_SCAN — reports `pending_scan`,
 *      not `scan_key_mismatch`. Both refuse, but only one tells the founder
 *      the truth, which is "the worker has not run yet".
 *
 *   3. The key binding is checked only inside SAFE, because that is the only
 *      place it can turn a permission into a refusal. A SAFE verdict issued
 *      for a different key is `scan_key_mismatch` — the file was replaced and
 *      the new bytes have never been scanned.
 *
 * The null trap `isDeliverableSafe` documents cannot arise here: step 1 has
 * already excluded `fileKey === null`, so by the time the keys are compared a
 * null `fileScanKey` can only ever be unequal. There is no path on which
 * `null === null` is read as a match.
 */
export function deliverableGateReason(
  product: DeliverableSafety
): DeliverableGateReason {
  if (product.fileKey === null) return "missing_file_key";

  switch (product.fileScanStatus) {
    case "UNSAFE":
      return "unsafe";
    case "SCAN_ERROR":
      return "scan_error";
    case "PENDING_SCAN":
      return "pending_scan";
    case "SAFE":
      return product.fileScanKey === product.fileKey
        ? "safe"
        : "scan_key_mismatch";
    default:
      // Unreachable against the current enum, and kept anyway: a status added
      // by a later migration and not handled here must refuse, never fall
      // through to a permission. Reported as a failed scan because that is the
      // nearest existing category — inventing one would misdescribe the row.
      return "scan_error";
  }
}

/**
 * Database-level equivalent, for gating inside a query rather than filtering
 * after the fact.
 *
 * The column-to-column comparison uses a Prisma field reference, so the whole
 * predicate — including `fileScanKey = fileKey` — is evaluated by Postgres and
 * cannot be forgotten by a caller that only remembers the status.
 */
export const SAFE_DELIVERABLE_WHERE = {
  fileKey: { not: null },
  fileScanStatus: "SAFE",
  fileScanKey: { equals: prisma.product.fields.fileKey },
} satisfies Prisma.ProductWhereInput;

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export type ProvenanceFailure =
  | "missing"
  | "wrong_shop"
  | "wrong_route";

export type ProvenanceResult =
  | {
      ok: true;
      asset: {
        key: string;
        scanStatus: FileScanStatus;
        scanSha256: string | null;
        scanAt: Date | null;
      };
    }
  | { ok: false; reason: ProvenanceFailure };

/**
 * Prove that a storage key may be attached to a product in this shop.
 *
 * Host pinning established that a key belongs to SaiFlow's UploadThing app.
 * It could not establish *which shop* uploaded it, so a seller who learned
 * another shop's key could still attach it. Provenance closes that: the
 * FileAsset row was written by `onUploadComplete` from server-verified
 * middleware metadata, so its shopId and route are facts about the upload
 * rather than claims about it.
 *
 * Three separate checks, because each catches a different mistake:
 *   missing     — the object was never uploaded through our routes
 *   wrong_shop  — a real upload, but someone else's
 *   wrong_route — a real upload for this shop, but as a logo or thumbnail;
 *                 those carry different size and ACL rules, so they must not
 *                 become deliverables
 *
 * Fails closed: any non-ok result means the write is rejected.
 */
export async function verifyDeliverableProvenance(
  key: string,
  shopId: string
): Promise<ProvenanceResult> {
  const asset = await prisma.fileAsset.findUnique({
    where: { key },
    select: {
      key: true,
      shopId: true,
      route: true,
      scanStatus: true,
      scanSha256: true,
      scanAt: true,
    },
  });

  return provenanceVerdict(asset, shopId);
}

/**
 * The decision itself, separated from the lookup so it can be exercised
 * directly. Every rejection path is a distinct branch, and each one is tested.
 */
export function provenanceVerdict(
  asset: {
    key: string;
    shopId: string;
    route: UploadRoute;
    scanStatus: FileScanStatus;
    scanSha256: string | null;
    scanAt: Date | null;
  } | null,
  shopId: string
): ProvenanceResult {
  if (!asset) return { ok: false, reason: "missing" };
  if (asset.shopId !== shopId) return { ok: false, reason: "wrong_shop" };
  if (asset.route !== "PRODUCT_FILE") return { ok: false, reason: "wrong_route" };

  return {
    ok: true,
    asset: {
      key: asset.key,
      scanStatus: asset.scanStatus,
      scanSha256: asset.scanSha256,
      scanAt: asset.scanAt,
    },
  };
}

/**
 * The scan columns to write on a product when a deliverable is attached.
 *
 * Copies whatever verdict the file already has. `fileScanKey` is bound only
 * once a real verdict exists — while the file is still PENDING_SCAN the
 * binding stays null, so the product is not safe on either clause of the
 * predicate. If the worker settles the file later, its key-bound updateMany
 * fills these in.
 */
export function attachedScanFields(asset: {
  key: string;
  scanStatus: FileScanStatus;
  scanSha256: string | null;
  scanAt: Date | null;
}) {
  const settled = asset.scanStatus !== "PENDING_SCAN";
  return {
    fileScanStatus: asset.scanStatus,
    fileScanKey: settled ? asset.key : null,
    fileScanSha256: settled ? asset.scanSha256 : null,
    fileScanAt: settled ? asset.scanAt : null,
    fileScanAttempts: 0,
  };
}

/**
 * Recorded as the actor on scan audit events.
 *
 * There is exactly one provider, and the FileAsset row does not store which
 * engine produced its verdict, so this constant is the single place the
 * attribution is written when reconciling.
 */
export const SCAN_AUDIT_ACTOR = "scanner:cloudmersive";

/**
 * Settle a product whose attachment crossed paths with the scan.
 *
 * THE RACE. Attaching a file reads the FileAsset, then writes the product. If
 * the worker finalises in between, its key-bound `updateMany` finds no product
 * yet — the row does not exist — while the attachment writes the PENDING_SCAN
 * it read a moment earlier. Nothing is unsafe (PENDING_SCAN is fail-closed),
 * but the product would sit unscannable and unsellable forever, with no event
 * ever arriving to move it.
 *
 * Running immediately after the write closes the window: the asset is read
 * again, and a terminal verdict is copied across.
 *
 * Three properties keep this safe:
 *   - it never invents a verdict; it copies whatever the FileAsset already has
 *   - `fileKey` is in the WHERE, so a product since pointed at another upload
 *     is untouched
 *   - it only transitions PENDING_SCAN, so it can never overwrite a verdict
 *     the worker already wrote, and re-running it changes nothing
 */
export async function reconcileProductScanState(
  productId: string,
  fileKey: string
): Promise<void> {
  const asset = await prisma.fileAsset.findUnique({
    where: { key: fileKey },
    select: { scanStatus: true, scanSha256: true, scanAt: true, scanReason: true },
  });

  // Still unscanned: nothing to reconcile, the worker will propagate later.
  if (!asset || asset.scanStatus === "PENDING_SCAN") return;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.product.updateMany({
      where: { id: productId, fileKey, fileScanStatus: "PENDING_SCAN" },
      data: {
        fileScanStatus: asset.scanStatus,
        fileScanKey: fileKey,
        fileScanSha256: asset.scanSha256,
        fileScanAt: asset.scanAt,
      },
    });

    // Someone else settled it first, or the file changed again. Either way
    // this reconciliation is stale and writes no audit event.
    if (updated.count !== 1) return;

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { moderationStatus: true },
    });
    if (!product) return;

    const status = asset.scanStatus.toLowerCase();
    await tx.moderationEvent.create({
      data: {
        productId,
        action: "SCANNED",
        actor: SCAN_AUDIT_ACTOR,
        reason: asset.scanReason
          ? `file-scan:${status}:${asset.scanReason}`
          : `file-scan:${status}`,
        categories: asset.scanReason ? [asset.scanReason] : [],
        // A scan never moves the moderation state by itself.
        previousStatus: product.moderationStatus,
        newStatus: product.moderationStatus,
      },
    });
  });
}
