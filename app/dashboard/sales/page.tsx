"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatPrice } from "@/lib/formatPrice";
import { formatDate } from "@/lib/formatDate";
import { formatNumber } from "@/lib/formatNumber";

interface Order {
  id: string;
  productId: string;
  productName: string;
  price: number;
  customerEmail: string;
  stripeSessionId: string;
  createdAt: string;
  product: {
    currency: string;
    shop: {
      name: string;
      slug: string;
    };
  };
}

interface OrdersData {
  orders: Order[];
  totalRevenue: number;
  totalSales: number;
}

export default function SalesPage() {
  const { status } = useSession();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("dashboard");

  const [data, setData] = useState<OrdersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const revenueCurrencies = new Set((data?.orders || []).map((o) => o.product.currency || "SAR"));
  const revenueIsMixed = revenueCurrencies.size > 1;
  const revenueCurrency = revenueCurrencies.size === 1 ? [...revenueCurrencies][0] : "SAR";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }

    if (status === "authenticated") {
      fetchOrders();
    }
  }, [status, router]);

  async function fetchOrders() {
    try {
      const res = await fetch("/api/orders");
      const ordersData = await res.json();

      if (!res.ok) {
        setError(ordersData.error || t("sales.errorFailedFetch"));
        return;
      }

      setData(ordersData);
    } catch {
      setError(t("shop.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-500"></div>
          <p className="text-gray-500">{t("sales.loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-50 border border-red-100 rounded-2xl p-6">
            <h1 className="text-2xl font-bold text-red-600 mb-2">{t("shop.errorTitle")}</h1>
            <p className="text-red-500 mb-4">{error}</p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 transition-colors"
            >
              <svg className="w-5 h-5 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {t("shop.backToDashboard")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">{t("sales.heading")}</h1>
          <p className="text-gray-500 mt-1">{t("sales.subtitle")}</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">{t("totalRevenue")}</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {revenueIsMixed ? t("mixedCurrency") : <bdi>{formatPrice(Number(data?.totalRevenue || 0), revenueCurrency, locale)}</bdi>}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">{t("totalSales")}</p>
                <p className="text-3xl font-bold text-white mt-1">{formatNumber(data?.totalSales || 0, locale)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Orders table */}
        <div className="bg-[#111111] rounded-xl border border-gray-800 overflow-hidden">
          <div className="bg-[#0a0a0a] px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-white">{t("sales.recentOrders")}</h2>
          </div>

          {data?.orders && data.orders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800 bg-[#111111]">
                    <th className="text-start text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                      {t("sales.colDate")}
                    </th>
                    <th className="text-start text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                      {t("sales.colProduct")}
                    </th>
                    <th className="text-start text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                      {t("sales.colCustomer")}
                    </th>
                    <th className="text-start text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                      {t("sales.colShop")}
                    </th>
                    <th className="text-end text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                      {t("sales.colAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((order) => (
                    <tr key={order.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(order.createdAt, locale, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-6 py-4 text-sm text-white font-medium">
                        {order.productName}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {order.customerEmail}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <Link
                          href={`/dashboard/shop/${order.product.shop.slug}`}
                          className="text-teal-600 hover:text-teal-700 transition-colors"
                        >
                          {order.product.shop.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-end text-sm font-semibold text-teal-400">
                        <bdi>{formatPrice(Number(order.price), order.product.currency, locale)}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-16 bg-[#111111]">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto text-gray-500">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                  />
                </svg>
              </div>
              <h3 className="text-gray-400 mt-4">{t("sales.emptyState")}</h3>
              <Link
                href="/dashboard"
                className="mt-4 inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 font-medium transition-colors"
              >
                <svg className="w-5 h-5 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                {t("shop.backToDashboard")}
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

