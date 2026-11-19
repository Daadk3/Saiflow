import { hostedAccessReady } from "@/lib/hosted-access/validate";

/**
 * Why the founder's Approve button is disabled, or null when the moderation
 * route would accept the decision.
 *
 * The button used to read only file safety. A HOSTED_ACCESS product has no
 * file key, so that always said `missing_file_key` and Approve stayed grey,
 * even though POST /api/admin/moderation/[productId] approves a hosted
 * product whose access record passes the link rules and which has no
 * deliverable rows.
 *
 * This follows that route, in the same order: access first, then stray
 * files. A relation that was not loaded is not "no files" — it fails closed,
 * the same way the route treats a non-array. FILE products keep the file
 * safety result they already had (`publishable`, otherwise the reason).
 */
export function approveBlockedReason(product: {
  deliveryType?: "FILE" | "HOSTED_ACCESS" | null;
  fileSafety: { publishable: boolean; reason: string };
  hostedAccess?: { accessUrl: string; instructions: string | null } | null;
  /** Deliverable rows. Anything other than an array fails closed for hosted products. */
  deliverables?: readonly unknown[] | null;
}): string | null {
  if (product.deliveryType === "HOSTED_ACCESS") {
    if (!hostedAccessReady(product.hostedAccess)) return "hosted_access_missing";
    if (!Array.isArray(product.deliverables) || product.deliverables.length > 0) return "hosted_has_files";
    return null;
  }
  return product.fileSafety.publishable ? null : product.fileSafety.reason;
}
