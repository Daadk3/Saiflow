import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/site-url";

/**
 * Email verification: proof that whoever holds an account also holds its inbox.
 *
 * WHY IT EXISTS. Every authority check in SaiFlow keys on the session email:
 * shop membership resolves a user by it, and admin status is
 * `isAdminEmail(session.user.email)`. Signup used to accept any address
 * without proof, so anyone could register an address they did not own,
 * including an admin address nobody had claimed yet, and be treated as its
 * owner everywhere.
 *
 * WHAT VERIFYING REQUIRES: the emailed token AND the account's password,
 * together. The token alone is not enough, on purpose. Whoever registers an
 * address can make SaiFlow email its real owner a verification link; if one
 * click verified the account, the owner would be confirming an account whose
 * password the squatter chose. Requiring the password means only the person
 * who created the account and controls the inbox can complete it. An owner
 * who did not create the account claims the address through "forgot
 * password" instead, which replaces the squatter's password and verifies the
 * address in the same step.
 *
 * TOKENS are 32 random bytes, emailed once and stored only as a SHA-256 hash,
 * so a database read never yields a usable link. They are single use and
 * expire after 24 hours. Issuing a new one revokes the previous one.
 */

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PREFIX = "email-verify:";

/** The stored form of a token. The raw value exists only in the email. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * The token row's identifier binds it to one account AND the address the
 * email went to, so a token can never verify an address it was not sent to.
 */
function identifierFor(userId: string, email: string): string {
  return `${IDENTIFIER_PREFIX}${userId}:${email.toLowerCase()}`;
}

function parseIdentifier(identifier: string): { userId: string; email: string } | null {
  if (!identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  const rest = identifier.slice(IDENTIFIER_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { userId: rest.slice(0, sep), email: rest.slice(sep + 1) };
}

/**
 * Mint a verification token for an account and return the raw value to email.
 * Any earlier token for the same account stops working.
 */
export async function issueVerificationToken(user: { id: string; email: string }): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({
      where: { identifier: { startsWith: `${IDENTIFIER_PREFIX}${user.id}:` } },
    }),
    prisma.verificationToken.create({
      data: {
        identifier: identifierFor(user.id, user.email),
        token: hashToken(raw),
        expires: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    }),
  ]);
  return raw;
}

export type VerifyOutcome = "verified" | "invalid" | "expired" | "wrong_password";

/**
 * Verify an address from its emailed token plus the account's password.
 *
 * A wrong password leaves the token usable, so a typo does not burn the link;
 * the route in front of this is rate-limited. Everything else that fails
 * reads as "invalid", without saying which part failed.
 */
export async function verifyEmailWithToken(input: {
  token: unknown;
  password: unknown;
}): Promise<VerifyOutcome> {
  const { token, password } = input;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return "invalid";
  if (typeof password !== "string" || password.length === 0) return "wrong_password";

  const hashed = hashToken(token);
  const record = await prisma.verificationToken.findUnique({ where: { token: hashed } });
  if (!record) return "invalid";

  const bound = parseIdentifier(record.identifier);
  if (!bound) return "invalid";

  if (record.expires.getTime() < Date.now()) {
    await prisma.verificationToken.deleteMany({ where: { token: hashed } });
    return "expired";
  }

  const user = await prisma.user.findUnique({
    where: { id: bound.userId },
    select: { id: true, email: true, password: true, emailVerified: true },
  });
  if (!user || user.email.toLowerCase() !== bound.email) return "invalid";

  if (!(await bcrypt.compare(password, user.password))) return "wrong_password";

  // Consume before granting: of two concurrent requests, only the one whose
  // delete removed the row goes on to verify.
  const consumed = await prisma.verificationToken.deleteMany({ where: { token: hashed } });
  if (consumed.count !== 1) return "invalid";

  if (!user.emailVerified) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
  }
  return "verified";
}

/**
 * A short fingerprint of an account's current password hash.
 *
 * Stored in the session token at sign-in and compared on every request, so a
 * password change (a reset, or Google sign-in reclaiming an unverified
 * account) ends every session that was opened with the old password. It is a
 * digest of a bcrypt hash inside an encrypted cookie, and reveals nothing
 * about the password itself.
 */
export function credentialFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash, "utf8").digest("hex").slice(0, 32);
}

/**
 * A password hash nobody knows: for accounts that sign in with Google only,
 * and for an unverified account whose password must stop working.
 *
 * Replaces `oauth-<email>-<timestamp>`, which anyone who knew roughly when an
 * account was created could have guessed.
 */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("hex"), 10);
}

/**
 * Where verification links point.
 *
 * Never derived from the request: a link built from a Host header could send
 * the token to someone else's domain. Production uses the canonical literal.
 * A Preview uses its own deployment URL, which Vercel sets and no client can
 * influence, so a Preview's emails open that Preview. Anything else is local
 * development.
 */
export function verificationEmailOrigin(): string {
  if (process.env.VERCEL_ENV === "production") return SITE_URL;
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function verificationUrl(rawToken: string): string {
  return `${verificationEmailOrigin()}/verify-email?token=${encodeURIComponent(rawToken)}`;
}
