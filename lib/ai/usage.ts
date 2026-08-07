/**
 * Durable, database-backed usage limits for the AI Listing Assistant.
 *
 * The in-memory rate limiter in lib/rate-limit.ts resets on every cold start
 * and is per-serverless-instance, which is acceptable for shaping traffic but
 * NOT for anything billable. AI calls cost money per request, so the cap is
 * counted from AiGeneration rows instead.
 */

import { prisma } from "@/lib/prisma";

/** Private-beta caps, per user per rolling 24 hours. */
export const DAILY_FULL_GENERATIONS = 5;
export const DAILY_SECTION_REGENERATIONS = 10;

export interface UsageState {
  fullUsed: number;
  sectionUsed: number;
  fullRemaining: number;
  sectionRemaining: number;
}

export async function getUsage(userId: string): Promise<UsageState> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Only successful generations count against the cap — a provider outage
  // should not consume a creator's daily allowance.
  const [fullUsed, sectionUsed] = await prisma.$transaction([
    prisma.aiGeneration.count({
      where: { userId, createdAt: { gte: since }, status: "SUCCEEDED", section: null },
    }),
    prisma.aiGeneration.count({
      where: { userId, createdAt: { gte: since }, status: "SUCCEEDED", section: { not: null } },
    }),
  ]);

  return {
    fullUsed,
    sectionUsed,
    fullRemaining: Math.max(0, DAILY_FULL_GENERATIONS - fullUsed),
    sectionRemaining: Math.max(0, DAILY_SECTION_REGENERATIONS - sectionUsed),
  };
}

/** True when this user may make the requested kind of call right now. */
export async function canGenerate(
  userId: string,
  isSection: boolean
): Promise<{ allowed: boolean; usage: UsageState }> {
  const usage = await getUsage(userId);
  const allowed = isSection ? usage.sectionRemaining > 0 : usage.fullRemaining > 0;
  return { allowed, usage };
}
