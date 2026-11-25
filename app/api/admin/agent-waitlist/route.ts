import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { agentWaitlistCsv } from "@/lib/agent-waitlist";

/**
 * The agent launch list as a CSV file, for SaiFlow's admins only.
 * Newest first. Reads the list; changes nothing.
 */
export async function GET(req: Request) {
  if (!rateLimiters.api(getClientIp(req)).success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !isAdminEmail(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await prisma.agentWaitlist.findMany({
      orderBy: { createdAt: "desc" },
      select: { email: true, agentSlug: true, locale: true, createdAt: true },
    });
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(agentWaitlistCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="agent-waitlist-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Agent waitlist export failed.", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
