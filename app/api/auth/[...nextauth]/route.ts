import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing email or password");
        }
        const user = await prisma.user.findFirst({
          where: { email: { equals: credentials.email, mode: "insensitive" } },
        });
        if (!user || !user.password) {
          throw new Error("User not found");
        }
        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
          throw new Error("Incorrect password");
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
  debug: true,
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
    async jwt({ token, user, account }) {
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
        (session.user as any).id = token.id;
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

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
