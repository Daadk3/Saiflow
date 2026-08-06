import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { rateLimiters } from "@/lib/rate-limit";
import { isAdminEmail } from "@/lib/admin";

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
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        try {
          let dbUser = await prisma.user.findFirst({
            where: { email: { equals: user.email!, mode: "insensitive" } },
          });

          if (!dbUser) {
            const dummyPassword = await bcrypt.hash(`oauth-${user.email}-${Date.now()}`, 10);
            dbUser = await prisma.user.create({
              data: {
                email: user.email!,
                name: user.name,
                image: user.image,
                password: dummyPassword,
              },
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
      // Always ensure we have the database user ID
      if (!token.id && token.email) {
        const dbUser = await prisma.user.findFirst({
          where: { email: { equals: token.email as string, mode: "insensitive" } },
        });
        if (dbUser) {
          token.id = dbUser.id;
        }
      }
      
      // For credentials sign-in, user object has the ID directly
      if (user?.id) {
        token.id = user.id;
        token.email = user.email;
      }
      
      return token;
    },
    async session({ session, token }) {
      if (session?.user && token?.id) {
        (session.user as { id?: string }).id = token.id as string;
      }
      // Surface admin status so the navbar can show the Founder Dashboard link.
      // Purely cosmetic: every admin page and API re-checks isAdminEmail on the
      // server, so a tampered client session grants no access.
      if (session?.user) {
        (session.user as { isAdmin?: boolean }).isAdmin = isAdminEmail(
          session.user.email
        );
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

