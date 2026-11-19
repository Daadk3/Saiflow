import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/formatDate";
import { formatPrice } from "@/lib/formatPrice";
import {
  getAdminSales,
  parseSaleScope,
  saleTotals,
  type AdminSaleRow,
  type PayoutStanding,
  type SaleScope,
} from "@/lib/admin-orders";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Every order on SaiFlow, for the founder. Admin-only through the admin
 * layout, the same guard as Seller payouts and Stores.
 */
export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const sp = await searchParams;
  const raw = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view = parseSaleScope(raw);
  const orders = await getAdminSales();
  const shown = orders.filter((order) => matches(order, view));
  const totals = saleTotals(shown);
  const realCount = orders.filter((order) => order.real).length;
  const testCount = orders.length - realCount;

  const money = (amount: string | null, currency: string) =>
    amount === null ? "—" : <bdi>{formatPrice(Number(amount), currency, locale)}</bdi>;

  const when = (date: Date) =>
    formatDate(date, locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Riyadh",
      hourCycle: "h23",
    });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link href="/dashboard/admin" className="text-sm text-gray-500 transition-colors hover:text-gray-300">
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("sales.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("sales.subtitle")}</p>
        </header>

        <nav className="mb-5 flex flex-wrap gap-2" aria-label={t("sales.filterLabel")}>
          <FilterChip href="/dashboard/admin/sales" active={view === "real"} label={t("sales.filterReal")} count={realCount} />
          <FilterChip href="/dashboard/admin/sales?view=test" active={view === "test"} label={t("sales.filterTest")} count={testCount} />
          <FilterChip href="/dashboard/admin/sales?view=all" active={view === "all"} label={t("sales.filterAll")} count={orders.length} />
        </nav>

        <section className="mb-6 rounded-2xl border border-gray-800 bg-[#111] p-5">
          <p className="text-sm text-gray-400">{t("sales.totalHeading", { count: shown.length })}</p>
          <p className="mt-1 text-xs text-gray-600">{t("sales.realNote")}</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {totals.map((total) => (
              <li key={total.currency} className="space-y-2">
                <p className="font-mono text-xs text-gray-500">{total.currency}</p>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-gray-500">{t("sales.gross")}</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-white">{money(total.gross, total.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">{t("sales.fee")}</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-gray-200">{money(total.fee, total.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">{t("sales.net")}</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-teal-300">{money(total.net, total.currency)}</dd>
                  </div>
                </dl>
                {total.unreadable > 0 && (
                  <p className="text-xs text-amber-400">{t("sales.unreadable", { count: total.unreadable })}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {shown.length === 0 ? (
          <p className="text-sm text-gray-400">{t("sales.empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full min-w-[72rem] text-sm">
              <thead className="bg-[#111] text-start text-xs text-gray-500">
                <tr>
                  {[
                    "colDate",
                    "colBuyer",
                    "colEmail",
                    "colProduct",
                    "colStore",
                    "colOwner",
                    "colGross",
                    "colFee",
                    "colNet",
                    "colCurrency",
                    "colPayment",
                    "colPayout",
                    "colEnvironment",
                    "colFounderTest",
                  ].map((key) => (
                    <th key={key} className="whitespace-nowrap px-3 py-3 text-start font-medium">
                      {t(`sales.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((order) => (
                  <tr key={order.id} className="border-t border-gray-800/80 align-top">
                    <td className="whitespace-nowrap px-3 py-3 text-gray-300">
                      <bdi>{when(order.createdAt)}</bdi>
                    </td>
                    <td className="px-3 py-3">
                      {order.buyerName ? <bdi>{order.buyerName}</bdi> : <span className="text-gray-500">{t("sales.notCollected")}</span>}
                    </td>
                    <td className="px-3 py-3" dir="ltr">
                      {order.buyerEmail ? <bdi>{order.buyerEmail}</bdi> : <span className="text-gray-500">{t("sales.notCollected")}</span>}
                    </td>
                    <td className="px-3 py-3">
                      <bdi>{order.productName}</bdi>
                    </td>
                    <td className="px-3 py-3">
                      <bdi>{order.storeName}</bdi>
                    </td>
                    <td className="px-3 py-3">
                      {order.owners.length === 0 ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <ul className="space-y-2">
                          {order.owners.map((owner) => (
                            <li key={owner.email}>
                              {owner.name && (
                                <span className="block">
                                  <bdi>{owner.name}</bdi>
                                </span>
                              )}
                              <span className="block text-gray-400" dir="ltr">
                                <bdi>{owner.email}</bdi>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-end">{money(order.gross, order.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-end">{money(order.fee, order.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-end text-teal-300">{money(order.net, order.currency)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-300">{order.currency}</td>
                    <td className="px-3 py-3">{t("sales.paid")}</td>
                    <td className="px-3 py-3">
                      <PayoutLabel standing={order.payoutStatus} label={t(`sales.payout.${order.payoutStatus}`)} />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{order.paymentEnvironment}</td>
                    <td className="px-3 py-3">{order.founderTest ? t("sales.founderYes") : t("sales.founderNo")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function matches(order: AdminSaleRow, view: SaleScope): boolean {
  if (view === "all") return true;
  if (view === "real") return order.real;
  return !order.real;
}

function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
        active ? "border-teal-500 bg-teal-500/10 text-teal-300" : "border-gray-800 bg-[#111] text-gray-300 hover:border-gray-600"
      }`}
      aria-current={active ? "page" : undefined}
    >
      {label}
      <span className="tabular-nums text-gray-500">{count}</span>
    </Link>
  );
}

function PayoutLabel({ standing, label }: { standing: PayoutStanding; label: string }) {
  const tone =
    standing === "paid" ? "text-teal-300" : standing === "owed" ? "text-amber-300" : "text-gray-500";
  return <span className={tone}>{label}</span>;
}
