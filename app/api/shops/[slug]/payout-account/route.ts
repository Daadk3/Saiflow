import { NextResponse } from "next/server";
import { runAfterResponse } from "@/lib/after-response";
import { notifyPayoutAccountChanged } from "@/lib/notify";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../../auth/authOptions";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import {
  PAYOUT_CURRENCY,
  maskIban,
  normalizeBankName,
  normalizeHolderName,
  normalizeIban,
  nextClearing,
  owedFor,
  splitByClearing,
  unpaidOrdersWhere,
} from "@/lib/payouts";

/**
 * A shop's payout details, balance and payout history, for the shop's OWNER.
 *
 * Bank details are personal data and decide where money goes, so only a
 * member with the OWNER role may read or change them; other members, and
 * everyone else, get the same 403. The IBAN is never sent back in full:
 * the owner sees it masked, like every other screen except the admin's
 * transfer screen.
 *
 * Nothing here moves money or changes an order. The balance is computed by
 * lib/payouts from the orders themselves, split into what is payable now and
 * what is still inside the clearing window; a payout is recorded only by an
 * admin, after the transfer was made (app/api/admin/payouts).
 */

type Owner = { shopId: string; userId: string };

/** The signed-in user, if they are an OWNER of this shop; otherwise the response to send. */
async function requireOwner(slug: string): Promise<Owner | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shop = await prisma.shop.findUnique({
    where: { slug },
    select: {
      id: true,
      shopUsers: { select: { role: true, userId: true, user: { select: { email: true } } } },
    },
  });
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const owner = shop.shopUsers.find(
    (member) => member.role === "OWNER" && member.user.email.toLowerCase() === email.toLowerCase()
  );
  if (!owner) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  return { shopId: shop.id, userId: owner.userId };
}

function accountView(account: { holderName: string; iban: string; bankName: string | null; updatedAt: Date } | null) {
  if (!account) return null;
  return {
    holderName: account.holderName,
    ibanMasked: maskIban(account.iban),
    bankName: account.bankName,
    updatedAt: account.updatedAt.toISOString(),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { slug } = await params;
    const owner = await requireOwner(slug);
    if (owner instanceof NextResponse) return owner;

    const [account, unpaid, payouts] = await Promise.all([
      prisma.sellerPayoutAccount.findUnique({
        where: { shopId: owner.shopId },
        select: { holderName: true, iban: true, bankName: true, updatedAt: true },
      }),
      prisma.order.findMany({
        where: unpaidOrdersWhere(owner.shopId),
        select: { sellerNetAmount: true, createdAt: true },
      }),
      prisma.payout.findMany({
        where: { shopId: owner.shopId },
        orderBy: { paidAt: "desc" },
        take: 50,
        select: { id: true, amount: true, currency: true, orderCount: true, bankReference: true, ibanLast4: true, paidAt: true },
      }),
    ]);

    const { payable, clearing } = splitByClearing(unpaid);
    const owed = owedFor(payable);
    const held = owedFor(clearing);
    const nextClears = nextClearing(clearing);
    return NextResponse.json({
      account: accountView(account),
      owed: { amount: owed.amount, currency: PAYOUT_CURRENCY, orderCount: owed.orderCount, unreadable: owed.unreadable },
      clearing: {
        amount: held.amount,
        currency: PAYOUT_CURRENCY,
        orderCount: held.orderCount,
        nextClearsAt: nextClears ? nextClears.toISOString() : null,
      },
      payouts: payouts.map((payout) => ({
        id: payout.id,
        amount: String(payout.amount),
        currency: payout.currency,
        orderCount: payout.orderCount,
        bankReference: payout.bankReference,
        ibanLast4: payout.ibanLast4,
        paidAt: payout.paidAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error loading payout details:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    // Bank details change rarely; a tight limit makes guessing or flooding pointless.
    if (!rateLimiters.payoutAccount(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { slug } = await params;
    const owner = await requireOwner(slug);
    if (owner instanceof NextResponse) return owner;

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const holderName = normalizeHolderName(body.holderName);
    if (holderName === null) return NextResponse.json({ error: "invalid_holder_name" }, { status: 400 });
    const iban = normalizeIban(body.iban);
    if (iban === null) return NextResponse.json({ error: "invalid_iban" }, { status: 400 });
    const bankName = normalizeBankName(body.bankName);
    if (bankName === undefined) return NextResponse.json({ error: "invalid_bank_name" }, { status: 400 });

    // Which IBAN was there before, to tell the owners when it changes.
    const previous = await prisma.sellerPayoutAccount.findUnique({
      where: { shopId: owner.shopId },
      select: { iban: true },
    });
    const saved = await prisma.sellerPayoutAccount.upsert({
      where: { shopId: owner.shopId },
      create: { shopId: owner.shopId, holderName, iban, bankName, updatedById: owner.userId },
      update: { holderName, iban, bankName, updatedById: owner.userId },
      select: { holderName: true, iban: true, bankName: true, updatedAt: true },
    });
    // Which shop, never the details.
    console.log("[payouts] account_saved", { shop: owner.shopId });
    // A new or different IBAN: every owner hears, after the reply. A stolen
    // session cannot then redirect payouts silently.
    if (previous?.iban !== saved.iban) {
      await runAfterResponse(() => notifyPayoutAccountChanged({ shopId: owner.shopId, ibanLast4: saved.iban.slice(-4) }));
    }
    return NextResponse.json({ account: accountView(saved) });
  } catch (error) {
    console.error("Error saving payout details:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
