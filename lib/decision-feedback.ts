/**
 * What the founder's decision controls do once the moderation route answers,
 * as plain functions so the behaviour is tested without a browser
 * (tests/decision-feedback.test.ts). Used by components/admin/DecisionButtons.
 *
 * Found on the Preview: after a rejection saved, the product page kept
 * showing "Pending" with both buttons live until a manual reload. The page
 * did ask for a refresh, but nothing checked that it arrived. Now the
 * refresh runs in a transition, the controls wait for it, and when it
 * finishes the page must show the decision just made; if it does not, the
 * page reloads from the server rather than show a stale status.
 */

export type Decision = "APPROVED" | "REJECTED";
type Status = "PENDING" | Decision;

/**
 * The route's answer, read. A refusal keeps the reject dialog open with the
 * error inside it; only success closes it.
 */
export type DecisionResult =
  | { ok: true }
  | { ok: false; error: { key: string } | { text: string } };

export function readDecisionResponse(ok: boolean, body: unknown): DecisionResult {
  if (ok) return { ok: true };
  const data = (body && typeof body === "object" ? body : {}) as { error?: unknown; reason?: unknown };
  if (data.error === "not_approvable") {
    // Never show the bare code: without a reason, say it failed.
    return { ok: false, error: { key: typeof data.reason === "string" ? `approveBlocked.${data.reason}` : "failed" } };
  }
  if (typeof data.error === "string" && data.error) return { ok: false, error: { text: data.error } };
  return { ok: false, error: { key: "failed" } };
}

/**
 * Where the page stands after a decision:
 * - "idle": no decision made here (or its message has gone);
 * - "waiting": the refresh is still running;
 * - "done": the page shows the decision, so say so;
 * - "reload": the refresh finished but the page still shows another status.
 */
export type AfterDecision = "idle" | "waiting" | "done" | "reload";

export function afterDecision(decided: Decision | null, shownStatus: Status, refreshing: boolean): AfterDecision {
  if (decided === null) return "idle";
  if (refreshing) return "waiting";
  return shownStatus === decided ? "done" : "reload";
}

/** How long the confirmation stays on screen. */
export const DECISION_TOAST_MS = 5000;
