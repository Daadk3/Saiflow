/**
 * Feature flag for the AI Listing Assistant — server-side only.
 *
 * Defaults OFF. Enabling requires AI_LISTING_ASSISTANT_ENABLED="true".
 *
 * While in private beta the assistant is additionally restricted to configured
 * admin accounts plus an optional explicit allowlist, so it cannot reach the
 * whole marketplace by flipping one variable.
 */

import { isAdminEmail } from "@/lib/admin";

export function isAiAssistantEnabled(email: string | null | undefined): boolean {
  if (process.env.AI_LISTING_ASSISTANT_ENABLED !== "true") return false;
  if (!email) return false;

  if (isAdminEmail(email)) return true;

  const allowlist = (process.env.AI_LISTING_BETA_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.toLowerCase());
}
