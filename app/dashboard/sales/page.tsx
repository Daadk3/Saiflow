"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

interface Order {
  id: string;
  productId: string;
  productName: string;
  price: number;
  customerEmail: string;
  stripeSessionId: string;
  createdAt: string;
  product: {
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

  const [data, setData] = useState<OrdersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError(ordersData.error || "Failed to fetch orders");
        return;
      }

      setData(ordersData);
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-500"></div>
          <p className="text-gray-400">Loading sales...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6">
            <h1 className="text-2xl font-bold text-red-400 mb-2">Error</h1>
            <p className="text-red-300 mb-4">{error}</p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/mascot.png"
                alt="Saiflow"
                width={48}
                height={48}
                className="h-12 w-auto object-contain"
              />
              <span className="text-xl font-bold text-white">Saiflow</span>
            </Link>

            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-gray-400 hover:text-teal-400 transition-colors group"
            >
              <svg
                className="w-5 h-5 transition-transform group-hover:-translate-x-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Sales</h1>
          <p className="mt-2 text-gray-400">Track your sales and revenue</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-8">
          {/* Total Revenue */}
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Total Revenue</p>
                <p className="text-4xl font-bold text-emerald-400 mt-1">
                  ${(data?.totalRevenue || 0).toFixed(2)}
                </p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Total Sales */}
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Total Sales</p>
                <p className="text-4xl font-bold text-white mt-1">{data?.totalSales || 0}</p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-teal-500/10 flex items-center justify-center">
                <svg className="w-7 h-7 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Orders Table */}
        <div className="bg-[#111111] rounded-2xl border border-gray-800/50 overflow-hidden">
          <div className="p-6 border-b border-gray-800/50">
            <h2 className="text-xl font-semibold text-white">Recent Orders</h2>
          </div>

          {data?.orders && data.orders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800/50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-4">
                      Date
                    </th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-4">
                      Product
                    </th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-4">
                      Customer
                    </th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-4">
                      Shop
                    </th>
                    <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-4">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {data.orders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-800/20 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-gray-400 text-sm">{formatDate(order.createdAt)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-white font-medium">{order.productName}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-gray-400 text-sm">{order.customerEmail}</span>
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/dashboard/shop/${order.product.shop.slug}`}
                          className="text-teal-400 hover:text-teal-300 text-sm transition-colors"
                        >
                          {order.product.shop.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-emerald-400 font-semibold">
                          ${Number(order.price).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/50 mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-400 mb-2">No sales yet</h3>
              <p className="text-gray-600 mb-6">When customers purchase your products, they&apos;ll appear here</p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 font-medium transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Dashboard
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

