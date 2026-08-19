import {
  deliverableGateReason,
  type DeliverableGateReason,
  type DeliverableSafety,
} from "@/lib/file-safety";

/**
 * What a moderator is told about a product's file before deciding.
 *
 * SERVER-SIDE ONLY, for the same reason as lib/creator-file-status.ts: this
 * imports lib/file-safety.ts, which builds a Prisma where-clause at load time
 * and must never enter a client bundle. Callers render the result server-side
 * and hand the browser a string.
 *
 * WHY THIS IS NOT THE CREATOR MAPPING. A creator is told what to do next, so
 * `creatorFileStatus` deliberately collapses six reasons into five words and
 * returns nothing at all when there is no file. A moderator is deciding
 * whether to publish someone else's work and needs the distinctions kept:
 * "the scanner has not run yet" and "the seller swapped the file after it
 * passed" call for different judgement even though both refuse. So all six
 * canonical reasons survive here, one for one.
 *
 * NO SECOND PREDICATE. Every field below is derived from
 * `deliverableGateReason`, which is the reviewed authority on what the scan
 * columns mean. Nothing re-reads fileKey, fileScanStatus or fileScanKey, so
 * this cannot drift away from the gate that actually refuses at checkout.
 *
 * Deliberately coarse. A reason, a boolean and a colour. No scan enum, no
 * storage key, no hash, no attempt count, no provider name — a moderator
 * decides on the listing and the file's contents, not on scanner telemetry.
 */

/** Visual weight only. Carries no authority and gates nothing. */
export type ModeratorFileTone = "ok" | "waiting" | "attention" | "blocked";

export interface ModeratorFileSafety {
  /** The canonical reason, unmodified. All six values are reachable. */
  reason: DeliverableGateReason;
  /**
   * Whether approving this product would actually put it on sale.
   *
   * True for `safe` and nothing else, which is exactly the condition
   * `isDeliverableSafe` returns true under — the equivalence is pinned by
   * test rather than by this comment.
   *
   * This is a statement ABOUT the public gate, never a substitute for it.
   * Nothing consults this value to decide what a buyer may see or buy; the
   * storefront queries carry `SAFE_DELIVERABLE_WHERE` and are unaffected by
   * anything in this module.
   */
  publishable: boolean;
  tone: ModeratorFileTone;
}

/**
 * Total by construction — every reason has a case and the compiler enforces
 * it, so a reason added by a later change fails the build here rather than
 * defaulting to `publishable: true`.
 */
export function moderatorFileSafety(
  product: DeliverableSafety
): ModeratorFileSafety {
  const reason = deliverableGateReason(product);

  switch (reason) {
    case "safe":
      return { reason, publishable: true, tone: "ok" };

    case "pending_scan":
      // The worker has not settled these bytes yet. Approving now is correct
      // and normal: the product goes live by itself the moment the scan
      // passes. This is the common path, not an error.
      return { reason, publishable: false, tone: "waiting" };

    case "scan_key_mismatch":
      // A SAFE verdict exists, but for bytes that are no longer attached —
      // the file was replaced after it passed. The scanner will pick the new
      // bytes up, so this waits like a fresh upload. Emphatically not
      // publishable, which is the property the tests pin.
      return { reason, publishable: false, tone: "waiting" };

    case "scan_error":
      // Also where an unrecognised status lands: deliverableGateReason maps
      // an enum this build has never heard of to `scan_error` rather than
      // inventing a category, so an unknown state surfaces as something a
      // human must look at and never as publishable.
      return { reason, publishable: false, tone: "attention" };

    case "unsafe":
      return { reason, publishable: false, tone: "blocked" };

    case "missing_file_key":
      // No deliverable at all. Not a scanner failure and not the seller's
      // file failing — there is simply nothing to sell yet.
      return { reason, publishable: false, tone: "attention" };
  }
}
