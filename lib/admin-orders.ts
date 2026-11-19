import { prisma } from "@/lib/prisma";
import { fromHalalas, parseMoney, sumMoney } from "@/lib/pricing";

/**
 * Every confirmed purchase, for the founder's sales page.
 *
 * An Order exists only after a provider has proven the money moved, so the
 * payment status of every row here is paid. Real and test follow the same
 * rule as the seller's totals and as payouts (lib/payouts): a real order was
 * paid on the PRODUCTION account and is not a founder test. Everything else
 * is a test, shown so the founder can see it, and never added into the real
 * total.
 *
 * The admin layout is what decides who may call this. Nothing here returns a
 * download bearer: no merchant reference, no Stripe session id.
 */

export type SaleScope = "real" | "test" | "all";
export type PayoutStanding = "paid" | "owed" | "notPayable";

export function parseSaleScope(value: string | undefined): SaleScope {
  if (value === "test" || value === "all") return value;
  return "real";
}

/** PRODUCTION, and not a founder's own check. The same line the seller totals use. */
export function isRealSale(order: { paymentEnvironment: string; founderTest: boolean }): boolean {
  return order.paymentEnvironment === "PRODUCTION" && order.founderTest === false;
}

/**
 * Whether the seller has been paid for this order.
 *
 * Paid out: a payout already names it. Owed: a real order with a readable
 * seller share and no payout, which is what lib/payouts would offer to pay.
 * Not payable: a test, a founder test, or an order from before the
 * commission existed.
 */
export function payoutStanding(order: {
  payoutId: string | null;
  paymentEnvironment: string;
  founderTest: boolean;
  net: string | null;
}): PayoutStanding {
  if (order.payoutId) return "paid";
  if (!isRealSale(order) || order.net === null) return "notPayable";
  return "owed";
}

export interface AdminSaleOwner {
  name: string | null;
  email: string;
}

export interface AdminSaleRow {
  id: string;
  createdAt: Date;
  buyerName: string | null;
  buyerEmail: string | null;
  productName: string;
  storeName: string;
  storeSlug: string;
  owners: AdminSaleOwner[];
  gross: string | null;
  fee: string | null;
  net: string | null;
  currency: string;
  /** An Order row is a confirmed payment. There is no other status to show. */
  paymentStatus: "PAID";
  payoutStatus: PayoutStanding;
  paymentEnvironment: "TEST" | "PRODUCTION";
  founderTest: boolean;
  real: boolean;
}

export interface SaleCurrencyTotal {
  currency: string;
  orders: number;
  gross: string;
  fee: string;
  net: string;
  /** Rows whose gross could not be read, left out of every figure above. */
  unreadable: number;
  /** Readable gross, but no commission snapshot. Fee and net omit these. */
  unsplit: number;
}

function asMoney(value: unknown): string | null {
  const halalas = parseMoney(value);
  return halalas === null ? null : fromHalalas(halalas);
}

/** Totals for the rows on screen, one group per currency. Empty means SAR 0.00. */
export function saleTotals(rows: Pick<AdminSaleRow, "currency" | "gross" | "fee" | "net">[]): SaleCurrencyTotal[] {
  const groups = new Map<string, Array<Pick<AdminSaleRow, "gross" | "fee" | "net">>>();
  for (const row of rows) {
    const list = groups.get(row.currency);
    if (list) list.push(row);
    else groups.set(row.currency, [row]);
  }
  if (groups.size === 0) {
    return [{ currency: "SAR", orders: 0, gross: "0.00", fee: "0.00", net: "0.00", unreadable: 0, unsplit: 0 }];
  }
  return [...groups.entries()].map(([currency, group]) => {
    const readable = group.filter((row) => row.gross !== null);
    const sum = (values: Array<string | null>) => fromHalalas(sumMoney(values.filter((value) => value !== null)).halalas);
    return {
      currency,
      orders: readable.length,
      gross: sum(readable.map((row) => row.gross)),
      fee: sum(readable.map((row) => row.fee)),
      net: sum(readable.map((row) => row.net)),
      unreadable: group.length - readable.length,
      unsplit: readable.filter((row) => row.net === null).length,
    };
  });
}

export async function getAdminSales(): Promise<AdminSaleRow[]> {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      customerEmail: true,
      customerName: true,
      productName: true,
      price: true,
      currency: true,
      grossAmount: true,
      platformFeeAmount: true,
      sellerNetAmount: true,
      paymentEnvironment: true,
      founderTest: true,
      payoutId: true,
      product: {
        select: {
          shop: {
            select: {
              name: true,
              slug: true,
              shopUsers: {
                where: { role: "OWNER" },
                orderBy: { joinedAt: "asc" },
                select: { user: { select: { name: true, email: true } } },
              },
            },
          },
        },
      },
    },
  });

  return orders.map((order) => {
    const gross = asMoney(order.grossAmount ?? order.price);
    const fee = order.platformFeeAmount === null ? null : asMoney(order.platformFeeAmount);
    const net = order.sellerNetAmount === null ? null : asMoney(order.sellerNetAmount);
    const email = order.customerEmail.trim();
    const environment = order.paymentEnvironment === "PRODUCTION" ? "PRODUCTION" : "TEST";
    const real = isRealSale({ paymentEnvironment: environment, founderTest: order.founderTest });
    return {
      id: order.id,
      createdAt: order.createdAt,
      buyerName: order.customerName?.trim() || null,
      buyerEmail: email.length > 0 ? email : null,
      productName: order.productName,
      storeName: order.product.shop.name,
      storeSlug: order.product.shop.slug,
      owners: order.product.shop.shopUsers.map((membership) => ({
        name: membership.user.name?.trim() || null,
        email: membership.user.email,
      })),
      gross,
      fee,
      net,
      currency: order.currency,
      paymentStatus: "PAID" as const,
      payoutStatus: payoutStanding({
        payoutId: order.payoutId,
        paymentEnvironment: environment,
        founderTest: order.founderTest,
        net,
      }),
      paymentEnvironment: environment,
      founderTest: order.founderTest,
      real,
    };
  });
}
