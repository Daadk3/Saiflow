/**
 * Error codes the sign-in flow shares with the browser.
 *
 * Kept in a module with no imports so client pages can read it without
 * pulling Prisma or bcrypt into the bundle.
 */

/**
 * Thrown by the credentials provider only AFTER the password has matched, so
 * it tells nobody anything they could not already learn by knowing the
 * password. NextAuth surfaces it to `signIn()` as `result.error`.
 */
export const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";
