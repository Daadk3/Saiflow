// TYPE ONLY. `lib/creator-file-status` imports `lib/file-safety`, which builds
// a Prisma where-clause at module load and must never enter a client bundle.
// A type import is erased at compile time, so this module stays safe to import
// from the dashboard — the same discipline the dashboard page already applies.
import type { CreatorFileStatus } from "@/lib/creator-file-status";

/**
 * What a creator is told about their permanent product link.
 *
 * THREE STATES, NOT SEVEN. The creator does not need the moderation enum
 * crossed with the five file-safety states; they need to know whether the link
 * they are about to paste into TikTok works yet. So: it works, it will work,
 * or it will not work as things stand.
 *
 * PRESENTATIONAL ONLY. This decides wording. It does not decide reachability
 * and nothing may ever route an authorisation decision through it. Public
 * eligibility is `SAFE_DELIVERABLE_WHERE` on the server, re-evaluated per
 * request, and the product page refuses to render for anything it excludes.
 * If this function were wrong in the permissive direction, the consequence is
 * an over-optimistic sentence — not a reachable page.
 *
 * WHY IT MIRRORS RATHER THAN RE-DERIVES. `fileSafety` arrives already computed
 * by `creatorFileStatus()` on the server, from the same columns the checkout
 * and download gates read; `"ready"` is `deliverableGateReason() === "safe"`,
 * documented there as equivalent to `isDeliverableSafe` by construction. So
 * this maps a server verdict onto words. It does not open the scan columns and
 * form a second opinion, which is how a display value quietly becomes a
 * competing definition of safety.
 *
 * `isActive` IS DELIBERATELY ABSENT. The schema comment defines public
 * visibility as `isActive && moderationStatus === APPROVED`, so a complete
 * mirror would include it. Nothing in the codebase ever writes
 * `Product.isActive = false` — there is no deactivation workflow in the
 * creator or admin UI, and the column is only ever read as a `where` filter —
 * so including it today would add a payload field to the seller API for a
 * condition that cannot differ. The assumption is pinned by test: if a
 * deactivation path is ever added, that test fails and this mapping must be
 * revisited before the field can silently go stale.
 */
export type ProductLinkStatus = "live" | "reserved" | "rejected";

export interface ProductLinkStatusInput {
  /** Optional because the seller payload marks it optional. */
  moderationStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
  /** Coarse, server-derived. Never a raw scan enum. */
  fileSafety: CreatorFileStatus;
}

export function productLinkStatus({
  moderationStatus,
  fileSafety,
}: ProductLinkStatusInput): ProductLinkStatus {
  // REJECTED wins over everything, including a file that passed its check.
  // A rejected product with a SAFE deliverable is the exact case where the
  // cheerful "live and ready to share" would be a lie, and it is reachable:
  // moderation rejects a listing on its content, which says nothing about the
  // bytes. Ordering this first is the whole reason precedence is pinned by a
  // test rather than left to the reader.
  if (moderationStatus === "REJECTED") return "rejected";

  // Both halves required. Approved-but-unscanned is not public, and
  // scanned-but-unapproved is not public either.
  if (moderationStatus === "APPROVED" && fileSafety === "ready") return "live";

  // Everything else — PENDING, undefined, or approved with a file still
  // checking, errored, blocked or absent. Reserved is the honest default: the
  // URL exists and belongs to this product, it just does not serve yet.
  return "reserved";
}

/** The message key, so the two surfaces cannot drift in their wording. */
export function productLinkStatusKey(
  status: ProductLinkStatus,
): "statusLive" | "statusReserved" | "statusRejected" {
  switch (status) {
    case "live":
      return "statusLive";
    case "rejected":
      return "statusRejected";
    case "reserved":
      return "statusReserved";
  }
}
