/**
 * Who may open a private deliverable, and in what state.
 *
 * Stage B made deliverables private, which broke every direct `fileUrl` link
 * the founder and sellers used to inspect a file. Stage D2 restores that
 * access through authorised, short-lived signed URLs. This module holds the
 * one decision both inspection routes ask — "given this file's scan state, may
 * this audience open it?" — so the founder route and the seller route cannot
 * drift into different answers.
 *
 * It decides NOTHING about identity. Whether the caller is really an admin, or
 * really a member of the owning shop, is settled by the route before this is
 * consulted. This function sees only a scan verdict and an audience label.
 *
 * FAIL-CLOSED BY CONSTRUCTION. An earlier draft enumerated the refusals and
 * let everything else fall through to a permission, which meant a scan state
 * added by a later migration would have been served rather than refused. The
 * policy below is a total table instead: a state is openable only because a
 * row says so. The Record type makes TypeScript reject an unenumerated state
 * at compile time, and the lookup treats a miss at runtime as a refusal, so
 * neither a new enum value nor a value this build has never heard of can
 * become a permission.
 *
 * WHAT "UNVERIFIED" MEANS. PENDING_SCAN, SCAN_ERROR and a stale key binding
 * are NOT safe and are never recorded as safe. They mean no verdict exists for
 * the attached bytes. The founder may open them because judging an unverified
 * file is exactly the work moderation exists to do; a seller may not, because
 * a signed URL is a transferable bearer credential and minting one over
 * unverified bytes is a quarantine bypass. Every permission carries a
 * `verification` marker so a caller can never mistake one for the other.
 */

import {
  deliverableGateReason,
  type DeliverableGateReason,
  type DeliverableSafety,
} from "@/lib/file-safety";

/**
 * Two audiences, with deliberately different powers.
 *
 * `admin`  — marketplace moderation authority (ADMIN_EMAILS).
 * `shop_member` — a verified member of the shop that owns the product.
 */
export type InspectAudience = "admin" | "shop_member";

/**
 * Whether the bytes behind a permitted inspection have a scan verdict.
 *
 * `verified`   — SAFE, bound to the key currently attached.
 * `unverified` — no verdict for these bytes. Never treat as safe.
 */
export type InspectVerification = "verified" | "unverified";

export type InspectRefusal =
  /** No storage key on the product, so there is nothing to sign. */
  | "no_file"
  /** The scanner rejected these bytes. No override exists in D2. */
  | "unsafe"
  /** No verdict for these bytes, and this audience requires one. */
  | "unverified"
  /** A scan state this build does not recognise. Refused, never served. */
  | "unknown_state";

export type InspectDecision =
  | { allow: true; verification: InspectVerification }
  | { allow: false; code: InspectRefusal; status: number };

const ALLOW_VERIFIED: InspectDecision = { allow: true, verification: "verified" };
const ALLOW_UNVERIFIED: InspectDecision = {
  allow: true,
  verification: "unverified",
};
const REFUSE_NO_FILE: InspectDecision = {
  allow: false,
  code: "no_file",
  status: 404,
};
const REFUSE_UNSAFE: InspectDecision = {
  allow: false,
  code: "unsafe",
  status: 403,
};
const REFUSE_UNVERIFIED: InspectDecision = {
  allow: false,
  code: "unverified",
  status: 409,
};
const REFUSE_UNKNOWN: InspectDecision = {
  allow: false,
  code: "unknown_state",
  status: 409,
};

/**
 * The policy, as a total table.
 *
 * Typing it `Record<InspectAudience, Record<DeliverableGateReason, …>>` is the
 * point: adding a scan state to `DeliverableGateReason` without deciding what
 * each audience may do with it becomes a compile error rather than a silent
 * permission.
 *
 * ADMIN — may open anything without a settled UNSAFE verdict, because
 *   moderation cannot happen behind a door the moderator may not open. UNSAFE
 *   is refused outright: D2 ships NO unsafe-inspection path. A deliberate flow
 *   for that (POST confirmation, CSRF protection, durable audit) is a separate
 *   design, not a query parameter bolted onto a GET.
 *
 * SHOP MEMBER — may open only a file with a SAFE verdict bound to the key
 *   currently attached, which is exactly what `deliverableGateReason` returns
 *   `safe` for and nothing else. Everything else is refused with no override.
 *   The seller already holds the original, so serving unverified or rejected
 *   bytes back adds nothing they lack; what it would add is a way to use
 *   SaiFlow's own storage and signing as a distribution channel for content
 *   that has not passed, or has failed, scanning.
 */
const POLICY: Record<
  InspectAudience,
  Record<DeliverableGateReason, InspectDecision>
> = {
  admin: {
    safe: ALLOW_VERIFIED,
    pending_scan: ALLOW_UNVERIFIED,
    scan_error: ALLOW_UNVERIFIED,
    scan_key_mismatch: ALLOW_UNVERIFIED,
    unsafe: REFUSE_UNSAFE,
    missing_file_key: REFUSE_NO_FILE,
  },
  shop_member: {
    safe: ALLOW_VERIFIED,
    pending_scan: REFUSE_UNVERIFIED,
    scan_error: REFUSE_UNVERIFIED,
    scan_key_mismatch: REFUSE_UNVERIFIED,
    unsafe: REFUSE_UNSAFE,
    missing_file_key: REFUSE_NO_FILE,
  },
};

/**
 * Look the decision up. There is no computed branch and no fallthrough: if the
 * table has no row for this audience and state, the answer is refusal.
 *
 * Both lookups are guarded even though TypeScript believes neither can miss.
 * The values arrive from the database at runtime, and a column that has grown
 * a new enum value in production while this build predates it is precisely the
 * case where the type system is not the thing protecting anyone.
 *
 * OWN PROPERTIES ONLY, and this is not theoretical: a plain `table[reason]`
 * lookup resolves `"constructor"`, `"toString"`, `"valueOf"` and friends to
 * inherited Object.prototype members. Those are truthy, so a `if (!decision)`
 * guard sails straight past them and returns a function where a decision
 * belongs — an object with no `allow` property at all. A test that fed those
 * exact strings in is what caught it.
 */
export function inspectDecision(
  reason: DeliverableGateReason,
  audience: InspectAudience
): InspectDecision {
  if (!Object.hasOwn(POLICY, audience)) return REFUSE_UNKNOWN;
  const table = POLICY[audience];

  if (!Object.hasOwn(table, reason)) return REFUSE_UNKNOWN;
  const decision = table[reason];

  // Belt and braces: an own property that is somehow not a decision is still
  // a refusal rather than whatever it happens to be.
  if (!decision || typeof decision.allow !== "boolean") return REFUSE_UNKNOWN;

  return decision;
}

/**
 * The scan statuses this build understands.
 *
 * WHY THIS EXISTS, because it is subtle and a runtime test is what found it.
 * `deliverableGateReason` maps a status it does not recognise onto
 * `scan_error` — a sound choice for a sellability gate, where every non-SAFE
 * answer refuses identically. But inspection is not sellability: the founder
 * is *allowed* to open a `scan_error` file, so routing an unknown status
 * through that mapping would quietly grant access to a state no one has
 * decided about yet.
 *
 * So inspection checks the raw column before the predicate collapses it. D1 is
 * reviewed and unchanged; this is the D2 layer declining to inherit a default
 * that was never meant to carry this weight.
 */
const KNOWN_SCAN_STATUSES: ReadonlySet<string> = new Set([
  "PENDING_SCAN",
  "SAFE",
  "UNSAFE",
  "SCAN_ERROR",
]);

/** `unknown_status` is not a DeliverableGateReason — it is the absence of one. */
export type InspectReason = DeliverableGateReason | "unknown_status";

/**
 * The single entry point both inspection routes use.
 *
 * Combining the raw-status check with the policy lookup means a route cannot
 * perform one and forget the other, which is exactly the mistake that would
 * reopen the hole described above.
 */
export function inspectProduct(
  product: DeliverableSafety,
  audience: InspectAudience
): { decision: InspectDecision; reason: InspectReason } {
  if (!KNOWN_SCAN_STATUSES.has(product.fileScanStatus)) {
    return { decision: REFUSE_UNKNOWN, reason: "unknown_status" };
  }

  const reason = deliverableGateReason(product);
  return { decision: inspectDecision(reason, audience), reason };
}

/**
 * How long an inspection URL stays valid.
 *
 * Inside the reviewed D1 range, and at its short end: inspection is a click
 * that resolves immediately, so nothing here needs longer than the default.
 */
export const INSPECT_TTL_SECONDS = 60;
