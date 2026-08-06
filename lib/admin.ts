/**
 * Marketplace admin check.
 *
 * ADMIN_EMAILS is a comma-separated list of email addresses with moderation
 * authority. Kept server-side only — never expose to the client bundle.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
