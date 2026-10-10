import type { FileScanStatus, ModerationStatus } from "@prisma/client";
import { runAfterResponse } from "@/lib/after-response";
import { notifyAdminsProductReadyForReview } from "@/lib/notify";

/**
 * The third way a product becomes SAFE for its file: it is WRITTEN that way.
 *
 * When a deliverable is attached whose FileAsset already carries a verdict,
 * `attachedScanFields` copies that verdict onto the product in the same
 * insert or update. Such a product never passes through the scan worker (the
 * file is settled) or the attach-time reconciliation (the row is not
 * PENDING_SCAN), so neither of them tells the founder. This does, from the
 * route, after the write has committed, with the same helper, the same link
 * and the same send-time re-check.
 *
 * Mutually exclusive with the other two announcers by construction. The
 * worker names only products its own verdict transaction moved out of an
 * unsettled state; the reconciliation names only a product its own
 * conditional update moved out of PENDING_SCAN; this names only a product
 * whose write already carried SAFE — a row the first two cannot move. Each
 * announcement is bound to the file key it was made for, so a later
 * replacement cancels it at send time.
 */
export interface AttachedProductView {
  id: string;
  fileKey: string | null;
  fileScanStatus: FileScanStatus;
  fileScanKey: string | null;
  moderationStatus: ModerationStatus;
}

/** SAFE for the file it currently sells, and still waiting for a decision. */
export function isReadyAtAttach(product: AttachedProductView): boolean {
  return (
    product.fileKey !== null &&
    product.fileScanStatus === "SAFE" &&
    product.fileScanKey === product.fileKey &&
    product.moderationStatus === "PENDING"
  );
}

/**
 * Tell the founder about a product written already SAFE. Resolves to whether
 * an announcement was scheduled; never throws, never delays the response.
 */
export async function announceReadyAtAttach(product: AttachedProductView): Promise<boolean> {
  if (!isReadyAtAttach(product)) return false;
  const key = product.fileKey as string;
  await runAfterResponse(() => notifyAdminsProductReadyForReview([product.id], key));
  return true;
}
