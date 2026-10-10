// TYPE ONLY. lib/seller-file-state reaches lib/scan/run and, through it,
// Prisma, so it must never enter a client bundle. A type import is erased at
// compile time — the same discipline the dashboard applies to
// lib/creator-file-status.
import type { SellerFileStateName } from "@/lib/seller-file-state";

/**
 * What a seller's product row says about the product's status.
 *
 * The server sends two facts per product — the moderation outcome and the
 * four-word file state — and the row used to show each on its own: "under
 * review" beside "file passed the check", which is accurate and confusing.
 * This turns the two into one story the seller can act on:
 *
 *   rejected                 → مرفوض (and the file only if it still needs attention)
 *   file passed + approved   → جاهز للبيع, on its own
 *   file passed, not yet approved → تم فحص الملف + بانتظار اعتماد المنتج
 *   file being checked       → جاري فحص الملف
 *   file check failed        → فشل فحص الملف, with a retry when one is possible
 *   no file                  → لا يوجد ملف
 *
 * PRESENTATION ONLY. This decides which badges to draw; it decides nothing
 * about reachability, sellability or delivery. "ready" is exactly the
 * condition lib/product-link-status calls "live" — a passed file (the
 * server-derived state that is `isDeliverableSafe` by construction) and an
 * approved listing — and nothing may route an authorisation decision through
 * it. If it were wrong in the permissive direction the consequence would be
 * an over-optimistic badge, not a sale.
 */
export type SellerBadge =
  | "rejected"
  | "ready"
  | "file_state"
  | "awaiting_approval"
  | "no_file";

export interface SellerBadgeInput {
  /** Optional because the seller payload marks it optional. */
  moderationStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
  hasFile: boolean;
  /** Server-derived (lib/seller-file-state); null when there is no file. */
  fileState?: { state: SellerFileStateName } | null;
}

export function sellerProductBadges({
  moderationStatus,
  hasFile,
  fileState,
}: SellerBadgeInput): SellerBadge[] {
  const badges: SellerBadge[] = [];
  const rejected = moderationStatus === "REJECTED";
  const approved = moderationStatus === "APPROVED";

  // A rejection is always said, first, whatever the file says: it is the one
  // outcome the seller cannot fix by touching the file.
  if (rejected) badges.push("rejected");

  if (!hasFile) {
    badges.push("no_file");
    return badges;
  }

  switch (fileState?.state) {
    case "passed":
      if (approved) {
        // Both halves done. One badge; the file badge would only repeat it.
        badges.push("ready");
      } else if (!rejected) {
        // The file is done and the listing is not: say both, in that order.
        badges.push("file_state", "awaiting_approval");
      }
      // Rejected with a passed file: the rejection alone. "File checked"
      // beside "rejected" reads as a contradiction, and there is nothing to
      // do about the file.
      break;
    case "uploaded":
    case "scanning":
    case "failed":
      // In progress or failed: the file badge carries the wording, the
      // reason and the retry. Approval is not mentioned until the file is
      // through — it is not the next step yet.
      badges.push("file_state");
      break;
    default:
      // A file with no derived state does not occur (the state is null only
      // when there is no file). Say nothing rather than guess.
      break;
  }

  return badges;
}
