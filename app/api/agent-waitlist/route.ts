import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimiters } from "@/lib/rate-limit";
import { AGENTS } from "@/components/agents/agents-data";

const AGENT_IDS = new Set(AGENTS.map((agent) => agent.id));

const bodySchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  agentSlug: z.string().refine((slug) => AGENT_IDS.has(slug)),
  locale: z.enum(["ar", "en"]).optional(),
});

/**
 * "Notify me" for an /agents kit. Stores the email, the agent and the
 * language, and nothing else. Sends no email now. A repeat signup is a
 * success, so the form does not reveal who is already on the list.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { email, agentSlug, locale } = parsed.data;
  const ipLimit = rateLimiters.agentWaitlist(getClientIp(req));
  const emailLimit = rateLimiters.agentWaitlistEmail(email);
  if (!ipLimit.success || !emailLimit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    await prisma.agentWaitlist.upsert({
      where: { email_agentSlug: { email, agentSlug } },
      create: { email, agentSlug, locale: locale ?? "ar" },
      update: {},
    });
  } catch (error) {
    // The address stays out of the log; the error never contains it.
    console.error("Agent waitlist: could not store the signup.", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
