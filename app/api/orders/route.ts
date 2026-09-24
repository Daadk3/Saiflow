import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../auth/authOptions";
import { fromHalalas, parseMoney, sumMoney } from "@/lib/pricing";

// GET - Get orders for user's shops
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get the user and their shops
    const user = await prisma.user.findFirst({
      where: { email: { equals: session.user.email, mode: "insensitive" } },
      include: {
        shopUsers: {
          include: {
            shop: {
              include: {
                products: {
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get all product IDs from user's shops
    const productIds = user.shopUsers.flatMap((su) =>
      su.shop.products.map((p) => p.id)
    );

    // Get orders for these products
    const orders = await prisma.order.findMany({
      where: {
        productId: { in: productIds },
      },
      include: {
        product: {
          include: {
            shop: {
              select: {
                name: true,
                slug: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    /**
     * Totals, in halalas, through lib/pricing: no float ever touches money.
     *
     * REAL means PRODUCTION-environment orders only. TEST orders stay in the
     * list, flagged, so the seller can see a test purchase happen, but they
     * never count as revenue. An order fulfilled before the commission
     * existed has no split: its gross still counts, its commission and net
     * are reported as absent rather than reinterpreted.
     */
    const isReal = (order: { paymentEnvironment: string }) => order.paymentEnvironment === "PRODUCTION";
    const grossOf = (order: { grossAmount: unknown; price: unknown }) => order.grossAmount ?? order.price;
    const money = (value: unknown) => {
      const halalas = parseMoney(value);
      return halalas === null ? null : fromHalalas(halalas);
    };
    // Per row: exact two-decimal strings, or null. A null gross means the
    // row could not be read as money; it is shown as such and left out of
    // every total, never coerced to zero. A null commission or net with a
    // readable gross is an order that predates the commission.
    const rows = orders.map((order) => {
      const gross = money(grossOf(order));
      const commission = order.platformFeeAmount === null ? null : money(order.platformFeeAmount);
      const net = order.sellerNetAmount === null ? null : money(order.sellerNetAmount);
      const unreadable =
        gross === null ||
        (order.platformFeeAmount !== null && commission === null) ||
        (order.sellerNetAmount !== null && net === null);
      return { ...order, isTest: !isReal(order), unreadable, gross, commission, net };
    });
    const readable = rows.filter((row) => !row.unreadable);
    const real = readable.filter(isReal);
    const test = readable.filter((row) => !isReal(row));
    const sum = (values: Array<string | null>) => fromHalalas(sumMoney(values.filter((v) => v !== null)).halalas);
    const totals = {
      real: {
        orders: real.length,
        gross: sum(real.map((row) => row.gross)),
        commission: sum(real.map((row) => row.commission)),
        net: sum(real.map((row) => row.net)),
        unsplit: real.filter((row) => row.net === null).length,
        unreadable: rows.filter((row) => row.unreadable && isReal(row)).length,
      },
      test: {
        orders: test.length,
        gross: sum(test.map((row) => row.gross)),
        unreadable: rows.filter((row) => row.unreadable && !isReal(row)).length,
      },
    };

    return NextResponse.json({
      orders: rows,
      totals,
      // Kept for the overview card: REAL gross and REAL count, test excluded.
      totalRevenue: Number(totals.real.gross),
      totalSales: totals.real.orders,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

