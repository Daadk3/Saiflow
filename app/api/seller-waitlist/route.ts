import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimiters } from "@/lib/rate-limit";

const bodySchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  source: z.enum(["homepage", "footer"]).optional(),
  locale: z.enum(["ar", "en"]).optional(),
});

/**
 * Early-access list for outside sellers. Stores an email and nothing else.
 * A repeat address is a success, so the form does not reveal who already joined.
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

  const { email, source, locale } = parsed.data;
  const ipLimit = rateLimiters.sellerWaitlist(getClientIp(req));
  const emailLimit = rateLimiters.sellerWaitlistEmail(email);
  if (!ipLimit.success || !emailLimit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    await prisma.sellerWaitlist.upsert({
      where: { email },
      create: {
        email,
        source: source ?? "homepage",
        locale: locale ?? "ar",
      },
      update: {},
    });
  } catch (error) {
    console.error("Seller waitlist: could not store the address.", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
