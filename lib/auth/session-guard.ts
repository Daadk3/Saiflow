import { prisma } from "@/lib/prisma";
import { credentialFingerprint } from "@/lib/auth/email-verification";

/**
 * Whether a session token still describes an account it may act for.
 *
 * Runs on every session read, from the NextAuth `jwt` callback. A session is
 * honoured only while its account:
 *
 *   - still exists,
 *   - has a verified email address,
 *   - still has the email the token was issued for, and
 *   - still has the password the session was opened with.
 *
 * This is what makes every downstream check trustworthy without touching any
 * of them: shop membership and `isAdminEmail` both read the session email, and
 * after this guard that email is always a verified one.
 *
 * Failure THROWS rather than returning a reduced token. NextAuth 4 treats an
 * exception in the `jwt` callback as no session: `getServerSession` returns
 * null in every route handler and server component, so nothing protected is
 * served. The browser cookie itself is cleared by `/api/auth/session`, which
 * the client SessionProvider calls on load; `getServerSession` cannot set
 * cookies, so a revoked cookie lingers until then, honoured by nothing except
 * the /dashboard middleware's coarse "is there a cookie" check. A database
 * error fails the same way, closed.
 *
 * Tokens issued before this guard carry no fingerprint and are refused, so
 * every existing session ends once at deploy and each user signs in again.
 */

export type RevokeReason =
  | "no_account"
  | "account_missing"
  | "unverified"
  | "email_changed"
  | "credentials_changed";

export class SessionRevokedError extends Error {
  readonly reason: RevokeReason;
  constructor(reason: RevokeReason) {
    // Reason only: no email or id, because NextAuth logs this message.
    super(`session revoked: ${reason}`);
    this.name = "SessionRevokedError";
    this.reason = reason;
  }
}

export interface GuardedToken {
  id?: unknown;
  email?: unknown;
  cv?: unknown;
}

export async function assertSessionStillValid(token: GuardedToken): Promise<void> {
  if (typeof token.id !== "string" || token.id.length === 0) {
    throw new SessionRevokedError("no_account");
  }

  const account = await prisma.user.findUnique({
    where: { id: token.id },
    select: { email: true, emailVerified: true, password: true },
  });

  if (!account) throw new SessionRevokedError("account_missing");
  if (!account.emailVerified) throw new SessionRevokedError("unverified");
  if (typeof token.email !== "string" || token.email.toLowerCase() !== account.email.toLowerCase()) {
    throw new SessionRevokedError("email_changed");
  }
  if (typeof token.cv !== "string" || token.cv !== credentialFingerprint(account.password)) {
    throw new SessionRevokedError("credentials_changed");
  }
}
