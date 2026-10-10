import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { parseMoney } from "@/lib/pricing";
import {
  PAYABLE_ORDERS_WHERE,
  PAYOUT_CURRENCY,
  changedRecently,
  maskIban,
  normalizeBankReference,
  owedFor,
  payableOrdersWhere,
} from "@/lib/payouts";

/**
 * Manual payouts, for SaiFlow's admins only.
 *
 * GET: every shop that is owed money, with its payout details. The full IBAN
 * is included here, and only here, because the admin types it into the bank
 * to send the transfer.
 *
 * POST: record a transfer the admin has ALREADY made. Nothing here sends
 * money. The admin states what they saw (amount, number of orders, and the
 * version of the bank details they paid to); the route re-reads all three
 * inside one transaction and refuses if anything changed, so a payout always
 * covers exactly the orders it names and records the account actually paid,
 * and an order can be paid out once only: it is linked to the payout only if
 * it is still unpaid, and the whole recording rolls back otherwise.
 */

async function requireAdmin(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !isAdminEmail(email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return email.toLowerCase();
}

export async function GET(req: Request) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    const payable = await prisma.order.findMany({
      where: PAYABLE_ORDERS_WHERE,
      orderBy: { createdAt: "asc" },
      select: { sellerNetAmount: true, createdAt: true, product: { select: { shopId: true } } },
    });

    const byShop = new Map<string, { orders: Array<{ sellerNetAmount: unknown }>; oldest: Date }>();
    for (const order of payable) {
      const entry = byShop.get(order.product.shopId);
      if (entry) entry.orders.push(order);
      else byShop.set(order.product.shopId, { orders: [order], oldest: order.createdAt });
    }

    const shops = byShop.size
      ? await prisma.shop.findMany({
          where: { id: { in: [...byShop.keys()] } },
          select: {
            id: true,
            name: true,
            slug: true,
            payoutAccount: { select: { holderName: true, iban: true, bankName: true, updatedAt: true } },
          },
        })
      : [];

    const now = new Date();
    return NextResponse.json({
      shops: shops
        .map((shop) => {
          const entry = byShop.get(shop.id)!;
          const owed = owedFor(entry.orders);
          const account = shop.payoutAccount;
          return {
            shopId: shop.id,
            name: shop.name,
            slug: shop.slug,
            owed: { amount: owed.amount, currency: PAYOUT_CURRENCY, orderCount: owed.orderCount, unreadable: owed.unreadable },
            oldestOrderAt: entry.oldest.toISOString(),
            account: account
              ? {
                  holderName: account.holderName,
                  iban: account.iban,
                  ibanMasked: maskIban(account.iban),
                  bankName: account.bankName,
                  updatedAt: account.updatedAt.toISOString(),
                  changedRecently: changedRecently(account.updatedAt, now),
                }
              : null,
          };
        })
        .sort((a, b) => a.oldestOrderAt.localeCompare(b.oldestOrderAt)),
    });
  } catch (error) {
    console.error("Error loading payouts:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

class PayoutRefused extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: string, status: number, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export async function POST(req: Request) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const shopId = typeof body.shopId === "string" && body.shopId.length > 0 ? body.shopId : null;
    const expectedHalalas = parseMoney(body.expectedAmount);
    const expectedCount =
      typeof body.expectedOrderCount === "number" && Number.isInteger(body.expectedOrderCount) && body.expectedOrderCount > 0
        ? body.expectedOrderCount
        : null;
    const bankReference = normalizeBankReference(body.bankReference);
    const expectedAccountVersion = typeof body.expectedAccountUpdatedAt === "string" ? body.expectedAccountUpdatedAt : null;
    // A calendar date, as the admin's bank shows it. Stored at 00:00 UTC; a
    // date up to a day ahead of UTC is accepted, since Riyadh is UTC+3.
    const paidAt =
      typeof body.paidOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn) ? new Date(`${body.paidOn}T00:00:00Z`) : null;
    if (!shopId || expectedHalalas === null || expectedHalalas <= 0 || expectedCount === null) {
      return NextResponse.json({ error: "invalid_payout" }, { status: 400 });
    }
    if (bankReference === null) return NextResponse.json({ error: "invalid_bank_reference" }, { status: 400 });
    if (paidAt === null || Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "invalid_paid_at" }, { status: 400 });
    }
    if (expectedAccountVersion === null) return NextResponse.json({ error: "invalid_payout" }, { status: 400 });

    const recorded = await prisma.$transaction(async (tx) => {
      const account = await tx.sellerPayoutAccount.findUnique({ where: { shopId }, select: { iban: true, updatedAt: true } });
      if (!account) throw new PayoutRefused("no_payout_account", 409);
      // The bank details the admin paid to, and no later version of them.
      if (account.updatedAt.toISOString() !== expectedAccountVersion) throw new PayoutRefused("account_changed", 409);

      const orders = await tx.order.findMany({
        where: payableOrdersWhere(shopId),
        select: { id: true, sellerNetAmount: true },
      });
      const readable = orders.filter((order) => parseMoney(order.sellerNetAmount) !== null);
      const owed = owedFor(readable);
      if (owed.halalas !== expectedHalalas || owed.orderCount !== expectedCount) {
        throw new PayoutRefused("balance_changed", 409, { owed: { amount: owed.amount, orderCount: owed.orderCount } });
      }

      const payout = await tx.payout.create({
        data: {
          shopId,
          amount: owed.amount,
          currency: PAYOUT_CURRENCY,
          orderCount: owed.orderCount,
          bankReference,
          ibanLast4: account.iban.slice(-4),
          paidAt,
          recordedBy: admin,
        },
        select: { id: true, amount: true, orderCount: true, paidAt: true },
      });

      // Each order is linked only while still unpaid. If any was paid by a
      // concurrent recording, the counts differ and everything rolls back.
      const linked = await tx.order.updateMany({
        where: { id: { in: readable.map((order) => order.id) }, payoutId: null },
        data: { payoutId: payout.id },
      });
      if (linked.count !== readable.length) throw new PayoutRefused("balance_changed", 409);
      return payout;
    });

    console.log("[payouts] recorded", { payout: recorded.id, shop: shopId, orders: recorded.orderCount });
    return NextResponse.json({
      payout: {
        id: recorded.id,
        amount: String(recorded.amount),
        currency: PAYOUT_CURRENCY,
        orderCount: recorded.orderCount,
        paidAt: recorded.paidAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof PayoutRefused) {
      return NextResponse.json({ error: error.code, ...error.extra }, { status: error.status });
    }
    console.error("Error recording payout:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
