"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

interface Shop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  _count?: {
    products: number;
  };
}

interface OrderStats {
  totalRevenue: number;
  totalSales: number;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [shops, setShops] = useState<Shop[]>([]);
  const [orderStats, setOrderStats] = useState<OrderStats>({ totalRevenue: 0, totalSales: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }

    if (status === "authenticated") {
      fetchData();
    }
  }, [status, router]);

  async function fetchData() {
    try {
      // Fetch shops and orders in parallel
      const [shopsRes, ordersRes] = await Promise.all([
        fetch("/api/shops"),
        fetch("/api/orders"),
      ]);

      const shopsData = await shopsRes.json();
      const ordersData = await ordersRes.json();

      if (!shopsRes.ok) {
        setError(shopsData.error || "Failed to fetch shops");
        return;
      }

      setShops(shopsData);

      if (ordersRes.ok) {
        setOrderStats({
          totalRevenue: ordersData.totalRevenue || 0,
          totalSales: ordersData.totalSales || 0,
        });
      }
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Calculate stats
  const totalProducts = shops.reduce((acc, shop) => acc + (shop._count?.products || 0), 0);
  const totalShops = shops.length;

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-500"></div>
          <p className="text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-50 border border-red-100 rounded-2xl p-6">
            <h1 className="text-2xl font-bold text-red-600 mb-2">Error</h1>
            <p className="text-red-500">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Welcome header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">
            Welcome back, {session?.user?.name || "Creator"}!
          </h1>
          <p className="text-gray-500 mt-1">
            Here&apos;s what&apos;s happening with your digital products.
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total shops</p>
                <p className="text-3xl font-bold text-white mt-1">{totalShops}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total products</p>
                <p className="text-3xl font-bold text-white mt-1">{totalProducts}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total revenue</p>
                <p className="text-3xl font-bold text-white mt-1">
                  ${orderStats.totalRevenue.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3 mb-8">
          <Link
            href="/dashboard/create-shop"
            className="bg-teal-500 hover:bg-teal-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create shop
          </Link>
          {shops.length > 0 && (
            <>
              <Link
                href={`/dashboard/shop/${shops[0].slug}/add-product`}
                className="bg-[#111111] border border-gray-800 hover:border-gray-700 text-gray-200 px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Add product
              </Link>
              <Link
                href={`/shop/${shops[0].slug}`}
                className="bg-[#111111] border border-gray-800 hover:border-gray-700 text-gray-200 px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                View shop
              </Link>
            </>
          )}
          <Link
            href="/dashboard/sales"
            className="bg-[#111111] border border-gray-800 hover:border-gray-700 text-gray-200 px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            View sales
          </Link>
        </div>

        {/* Shops list */}
        <div className="bg-[#111111] rounded-xl border border-gray-800 overflow-hidden">
          <div className="bg-[#0a0a0a] px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Your shops</h2>
            <span className="text-sm text-gray-500">
              {shops.length} {shops.length === 1 ? "shop" : "shops"}
            </span>
          </div>

          {shops.length > 0 ? (
            <div>
              {shops.map((shop) => (
                <Link
                  key={shop.id}
                  href={`/dashboard/shop/${shop.slug}`}
                  className="px-6 py-4 border-b border-gray-800 hover:bg-gray-800/50 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center text-white font-semibold">
                      {shop.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-white">{shop.name}</p>
                      <p className="text-sm text-gray-500">
                        {shop.description || "No description"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">
                        {shop._count?.products || 0}
                      </p>
                      <p className="text-xs text-gray-500">products</p>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-[#111111]">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto text-gray-500">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
              </div>
              <p className="text-gray-400 mt-4">You don&apos;t have any shops yet.</p>
              <Link
                href="/dashboard/create-shop"
                className="mt-4 bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create your first shop
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
