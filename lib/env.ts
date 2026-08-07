import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Server-side environment variables schema
   */
  server: {
    DATABASE_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url().optional(),
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    UPLOADTHING_TOKEN: z.string().min(1),
    RESEND_API_KEY: z.string().startsWith("re_"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Comma-separated emails with moderation authority (Trust & Safety Tier 0)
    ADMIN_EMAILS: z.string().optional(),
    // AI Listing Assistant (v1). Defaults off; server-side only.
    AI_LISTING_ASSISTANT_ENABLED: z.string().optional(),
    AI_LISTING_BETA_EMAILS: z.string().optional(),
    AI_PROVIDER: z.enum(["anthropic", "openai", "mock"]).optional(),
    AI_MODEL: z.string().optional(),
    AI_API_KEY: z.string().optional(),
    // Provider-conventional key names, accepted in place of AI_API_KEY.
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Pre-launch mode. Defaults to true (fail-closed); only "false"
    // disables it. Anything else (missing, empty, "true", typos) keeps
    // pre-launch ON.
    PRE_LAUNCH_MODE: z
      .string()
      .default("true")
      .transform((v) => v !== "false"),
  },

  /**
   * Client-side environment variables schema
   */
  client: {
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
  },

  /**
   * Manual destructuring of process.env
   * Required because Next.js doesn't statically analyze process.env
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    AI_LISTING_ASSISTANT_ENABLED: process.env.AI_LISTING_ASSISTANT_ENABLED,
    AI_LISTING_BETA_EMAILS: process.env.AI_LISTING_BETA_EMAILS,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
    PRE_LAUNCH_MODE: process.env.PRE_LAUNCH_MODE,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  },

  /**
   * Skip validation in certain environments
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * Treat empty strings as undefined
   */
  emptyStringAsUndefined: true,
});
