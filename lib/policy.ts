/**
 * Version of the Terms of Service and Privacy Policy accepted at sign-up.
 *
 * Stored on `User.termsVersion` for accounts that accept it. Bump this when
 * those documents change in a way that needs a new acceptance. Existing rows
 * stay null until the person accepts a version; login does not require one.
 */
export const POLICY_VERSION = "2026-11-24";

/** English "Last updated" line, derived from POLICY_VERSION so the two cannot drift. */
export function policyUpdatedOn(): string {
  const [year, month, day] = POLICY_VERSION.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
