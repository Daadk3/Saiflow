// types/next-auth.d.ts
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** Cosmetic only — server re-checks isAdminEmail on every admin route. */
      isAdmin?: boolean;
      /**
       * Whether the AI Listing Assistant should be offered to this user.
       * Presentation only: /api/ai/listing re-evaluates the same flag on every
       * request, so a tampered client session buys nothing but a button that
       * returns FEATURE_DISABLED.
       */
      aiAssistantEnabled?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
  }
}