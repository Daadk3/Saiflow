import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { authOptions } from "@/app/api/auth/authOptions";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * "My purchases": every order placed under the signed-in buyer's address,
 * each with a download that never expires.
 *
 * Checkout is a guest flow, so an order is tied to an address, not an
 * account. A session exists only for a verified address (authOptions), so
 * signing in proves the inbox, which is the same proof the receipt was sent
 * to. Each download goes through the download route's account channel, which
 * re-checks the address and runs the safety gate on every click; this page
 * only lists. Rendered on the server, so it shows no spinner and no buyer
 * data travels to the browser beyond what is listed.
 */
export default async function PurchasesPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/login?callbackUrl=/dashboard/purchases");

  const t = await getTranslations("purchases");
  const locale = await getLocale();
  const orders = await prisma.order.findMany({
    where: { customerEmail: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      productId: true,
      productName: true,
      createdAt: true,
      paymentEnvironment: true,
      product: { select: { slug: true, shop: { select: { name: true, slug: true } } } },
    },
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="text-sm text-gray-500 transition-colors hover:text-gray-300">
          {t("back")}
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("subtitle", { email })}</p>

        {orders.length === 0 ? (
          <p className="mt-8 rounded-xl border border-gray-800 bg-[#0f0f0f] p-6 text-center text-gray-400">{t("empty")}</p>
        ) : (
          <ul className="mt-8 space-y-3">
            {orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-[#0f0f0f] p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-100" dir="auto">
                    {order.productName}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    <bdi>{order.product.shop.name}</bdi> · {formatDate(order.createdAt.toISOString(), locale)}
                    {order.paymentEnvironment !== "PRODUCTION" && <span className="ms-2 text-amber-400">{t("test")}</span>}
                  </p>
                </div>
                <a
                  href={`/api/download/${encodeURIComponent(order.productId)}?purchase=${encodeURIComponent(order.id)}`}
                  className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-400"
                >
                  {t("download")}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-8 text-xs text-gray-500">{t("help")}</p>
      </main>
    </div>
  );
}
