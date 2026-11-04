import { NextResponse } from "next/server";

import { authorizeFounderBot } from "@/lib/founder-bot/gate";
import { loadFounderUser } from "@/lib/founder-bot/owner";
import { redactId } from "@/lib/redact-id";
import { accountKey, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";
import { runAfterResponse } from "@/lib/after-response";
import { notifyAdminsStoreCreated } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { openStoreForOwner } from "@/lib/shops/open-store";

export const dynamic = "force-dynamic";

async function requireFounder(req: Request) {
  const gate = authorizeFounderBot(req);
  if (!gate.ok) return gate;
  const user = await loadFounderUser(gate.email);
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ok: true as const, user, email: gate.email };
}

/** The founder's own stores, and how many products each has. Nothing else. */
export async function GET(req: Request) {
  try {
    const auth = await requireFounder(req);
    if (!auth.ok) return auth.response;

    const shops = await prisma.shop.findMany({
      where: { shopUsers: { some: { userId: auth.user.id, role: "OWNER" } } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        country: true,
        city: true,
        createdAt: true,
        _count: { select: { products: true } },
      },
    });

    return NextResponse.json({
      stores: shops.map((shop) => ({
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        description: shop.description,
        country: shop.country,
        city: shop.city,
        createdAt: shop.createdAt,
        productCount: shop._count.products,
      })),
    });
  } catch (error) {
    console.error("[founder-bot] list stores failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/**
 * Open a store owned by the founder account. The body cannot name another user.
 * The new store is recorded on the admin notification and in the server log.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireFounder(req);
    if (!auth.ok) return auth.response;

    // Same store-creation budget as the dashboard, keyed by the same account.
    const shopLimit = rateLimiters.createShop(accountKey(auth.email));
    if (!shopLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(shopLimit.resetTime)) } }
      );
    }

    const body = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const opened = await openStoreForOwner({
      userId: auth.user.id,
      name: record.name,
      description: record.description,
      country: record.country,
      city: record.city,
    });
    if (!opened.ok) {
      return NextResponse.json({ error: opened.error }, { status: opened.status });
    }

    const shop = opened.shop;
    const creatorName = `${auth.user.name?.trim() || "Founder"} (founder bot)`;
    console.info(`[founder-bot] action=store-created shop=${redactId(shop.id)}`);
    await runAfterResponse(() =>
      notifyAdminsStoreCreated({
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        country: shop.country,
        city: shop.city,
        creatorName,
      })
    );

    return NextResponse.json({ store: shop }, { status: 201 });
  } catch (error) {
    console.error("[founder-bot] create store failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
