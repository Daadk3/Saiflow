import { deliverableGateReason, type DeliverableSafety } from "@/lib/file-safety";

/**
 * What a creator is told about their own product's file.
 *
 * SERVER-SIDE ONLY. This module imports lib/file-safety.ts, which builds a
 * Prisma where-clause at load time, so it must never enter a client bundle.
 * The browser receives the resulting string and renders it; it imports the
 * TYPE from here and nothing else.
 *
 * That direction is the point. An earlier draft shipped fileKey,
 * fileScanStatus and fileScanKey to the browser and derived the badge there.
 * Nothing about it was exploitable — the decision was presentational and every
 * gate stayed server-side — but it put scan internals in a payload that had no
 * use for them, and it invited a future reader to treat a client value as a
 * safety fact. The derivation now happens where the authority already lives.
 *
 * Deliberately coarse. Five states, no scan enum, no key, no hash, no attempt
 * count, no provider name. A creator learns what to do next, not how the
 * scanner works.
 */
export type CreatorFileStatus =
  | "ready"
  | "checking"
  | "needs_attention"
  | "blocked"
  | null;

/**
 * Derived from `deliverableGateReason`, which is the reviewed authority on
 * what a product's scan columns mean. Nothing is restated here: this maps its
 * six reasons onto the five things worth saying to a creator, so the two
 * cannot drift.
 *
 * Total by construction — every reason has a case, and the compiler enforces
 * it. A reason added later fails the build rather than falling through to a
 * permission.
 */
export function creatorFileStatus(product: DeliverableSafety): CreatorFileStatus {
  switch (deliverableGateReason(product)) {
    case "safe":
      // Equivalent to isDeliverableSafe by construction, since that is what
      // "safe" means in the canonical vocabulary. Pinned by test.
      return "ready";

    case "pending_scan":
      return "checking";

    case "scan_key_mismatch":
      // The file was replaced and the new bytes have never been scanned; the
      // SAFE verdict on the row belongs to the file that is gone. From the
      // creator's side this is indistinguishable from a fresh upload awaiting
      // its check, and it is what the scanner is about to do — so "checking"
      // describes it honestly. It is emphatically NOT ready, which is the
      // property that matters and which the tests pin directly.
      return "checking";

    case "scan_error":
      // Also the destination for any status this build does not recognise:
      // deliverableGateReason maps an unknown enum here rather than inventing
      // a category, so an unhandled state surfaces as "needs attention" and
      // never as ready.
      return "needs_attention";

    case "unsafe":
      return "blocked";

    case "missing_file_key":
      // No deliverable attached. The dashboard's existing "no file" badge
      // already says this; a second badge saying it again is noise.
      return null;
  }
}
