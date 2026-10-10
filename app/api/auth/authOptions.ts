import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { rateLimiters } from "@/lib/rate-limit";
import { isAdminEmail } from "@/lib/admin";
import { isAiAssistantEnabled } from "@/lib/ai/flag";
import { EMAIL_NOT_VERIFIED } from "@/lib/auth/errors";
import { credentialFingerprint, unusablePasswordHash } from "@/lib/auth/email-verification";
import { assertSessionStillValid, SessionRevokedError } from "@/lib/auth/session-guard";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        // Single generic message everywhere below: distinct errors would let
        // an attacker enumerate which emails have accounts.
        const GENERIC = "Invalid email or password";

        if (!credentials?.email || !credentials?.password) {
          throw new Error(GENERIC);
        }

        // Brute-force throttle by client IP (5/min, same limiter as other auth routes)
        const forwarded = req?.headers?.["x-forwarded-for"];
        const ip =
          (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ??
          "unknown";
        if (!rateLimiters.auth(ip).success) {
          throw new Error("Too many attempts. Please try again in a minute.");
        }

        const user = await prisma.user.findFirst({
          where: { email: { equals: credentials.email, mode: "insensitive" } },
        });
        if (!user || !user.password) {
          throw new Error(GENERIC);
        }
        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
          throw new Error(GENERIC);
        }
        // Only after the password matched, so this reveals nothing to a
        // caller who does not already know it. Until the address is verified
        // the account cannot sign in at all: see lib/auth/email-verification.
        if (!user.emailVerified) {
          throw new Error(EMAIL_NOT_VERIFIED);
        }
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  debug: process.env.NODE_ENV === "development",
  // NextAuth automatically uses NEXTAUTH_URL from environment
  // The callback URL will be: ${NEXTAUTH_URL}/api/auth/callback/google
  // Make sure this exact URL is added to Google Cloud Console as an authorized redirect URI
  // For production: https://saiflow.io/api/auth/callback/google
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        // Google reports whether IT verified the address. Only a verified one
        // proves inbox ownership, so only that one may open or claim an account.
        const googleVerified = (profile as { email_verified?: unknown } | undefined)?.email_verified === true;
        if (!googleVerified || !user.email) {
          return false;
        }

        try {
          let dbUser = await prisma.user.findFirst({
            where: { email: { equals: user.email, mode: "insensitive" } },
          });

          if (!dbUser) {
            dbUser = await prisma.user.create({
              data: {
                email: user.email.toLowerCase(),
                name: user.name,
                image: user.image,
                // Google-only accounts get a password nobody knows.
                password: await unusablePasswordHash(),
                emailVerified: new Date(),
              },
            });
          } else if (!dbUser.emailVerified) {
            // Google has just proved who owns this inbox, and the account's
            // password was set before anyone proved that. It may belong to
            // whoever registered the address first, so it stops working here.
            // A genuine owner sets a new one through "forgot password". The new
            // password hash also ends every session opened with the old one.
            dbUser = await prisma.user.update({
              where: { id: dbUser.id },
              data: { emailVerified: new Date(), password: await unusablePasswordHash() },
            });
          }

          user.id = dbUser.id;
          return true;
        } catch (error) {
          console.error("Google sign-in error:", error);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      // Sign-in: bind the token to the account as it stands now. The email is
      // the stored one, not the provider's spelling, and the fingerprint ties
      // the session to the current password.
      if (user?.id) {
        const account = await prisma.user.findUnique({
          where: { id: user.id },
          select: { email: true, password: true },
        });
        if (!account) throw new SessionRevokedError("account_missing");
        token.id = user.id;
        token.email = account.email;
        token.cv = credentialFingerprint(account.password);
      }

      // Every request: the account must still exist, be verified and have the
      // same email and password. Throwing here makes every session read come
      // back empty, and /api/auth/session also clears the cookie.
      await assertSessionStillValid(token);
      return token;
    },
    async session({ session, token }) {
      if (session?.user && token?.id) {
        (session.user as { id?: string }).id = token.id as string;
        // The verified, stored address, which is what every authority check reads.
        session.user.email = token.email as string;
      }
      // Surface admin status so the navbar can show the Founder Dashboard link.
      // Purely cosmetic: every admin page and API re-checks isAdminEmail on the
      // server, so a tampered client session grants no access.
      if (session?.user) {
        (session.user as { isAdmin?: boolean }).isAdmin = isAdminEmail(
          session.user.email
        );
        // Same contract for the AI assistant: this decides only whether the
        // creator is offered the option. /api/ai/listing calls the identical
        // isAiAssistantEnabled on every request, so this cannot grant access —
        // it exists so that a disabled feature is absent rather than visibly
        // broken. Computed here rather than in the jwt callback so that
        // changing the environment variable takes effect without forcing
        // everyone to sign in again.
        (session.user as { aiAssistantEnabled?: boolean }).aiAssistantEnabled =
          isAiAssistantEnabled(session.user.email);
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Force post-auth redirects to dashboard while allowing absolute external redirects to fall back safely.
      const dashboardUrl = `${baseUrl}/dashboard`;

      // Relative URLs -> dashboard
      if (url.startsWith("/")) {
        return dashboardUrl;
      }

      // Same-origin URLs
      try {
        const target = new URL(url);
        if (target.origin === baseUrl) {
          return dashboardUrl;
        }
      } catch {
        // If URL parsing fails, fall back to dashboard
      }

      // Default fallback
      return dashboardUrl;
    },
  },
};

