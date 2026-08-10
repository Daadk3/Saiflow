/**
 * Marketplace admin check.
 *
 * ADMIN_EMAILS is a comma-separated list of email addresses with moderation
 * authority. Kept server-side only — never expose to the client bundle.
 */
/**
 * The configured admin addresses, normalised. Empty when unset.
 *
 * Exported so admin *notifications* use the same list as admin *authority*,
 * rather than a second copy of the parsing that could drift from it.
 */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
