/**
 * The signed-in account's id, from a NextAuth session.
 *
 * Ownership checks compare this id, not the email. An email comparison has
 * to choose between exact matching, which wrongly refuses an owner whose
 * stored address differs in case, and case-insensitive matching, which
 * would let two accounts whose addresses differ only in case reach each
 * other's shops. The id is set by authOptions' session callback from the
 * verified, still-valid token, and identifies exactly one account.
 */
export function sessionUserId(session: unknown): string | null {
  const id = (session as { user?: { id?: unknown } } | null | undefined)?.user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
