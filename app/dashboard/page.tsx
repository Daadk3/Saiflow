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
          <p className="text-gray-400">Loading dashboard...</p>
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
            <p className="text-red-300">{error}</p>
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

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">
            Welcome back, {session?.user?.name || "Creator"}! 👋
          </h1>
          <p className="mt-2 text-gray-400">
            Here&apos;s what&apos;s happening with your digital products
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          {/* Total Shops */}
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Total Shops</p>
                <p className="text-3xl font-bold text-white mt-1">{totalShops}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Total Products */}
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Total Products</p>
                <p className="text-3xl font-bold text-white mt-1">{totalProducts}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Total Sales */}
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Total Sales</p>
                <p className="text-3xl font-bold text-white mt-1">{orderStats.totalSales}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Total Revenue */}
          <Link 
            href="/dashboard/sales"
            className="bg-[#111111] rounded-2xl border border-gray-800/50 p-6 hover:border-emerald-500/30 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Total Revenue</p>
                <p className="text-3xl font-bold text-emerald-400 mt-1">
                  ${orderStats.totalRevenue.toFixed(2)}
                </p>
                <p className="text-xs text-gray-600 mt-1 group-hover:text-teal-400 transition-colors">View sales →</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </Link>
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/create-shop"
              className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-white font-medium px-5 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Shop
            </Link>
            {shops.length > 0 && (
              <>
                <Link
                  href={`/dashboard/shop/${shops[0].slug}/add-product`}
                  className="inline-flex items-center gap-2 bg-[#111111] hover:bg-[#1a1a1a] text-white font-medium px-5 py-2.5 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Add Product
                </Link>
                <Link
                  href={`/shop/${shops[0].slug}`}
                  className="inline-flex items-center gap-2 bg-[#111111] hover:bg-[#1a1a1a] text-white font-medium px-5 py-2.5 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Shop
                </Link>
              </>
            )}
            <Link
              href="/dashboard/sales"
              className="inline-flex items-center gap-2 bg-[#111111] hover:bg-[#1a1a1a] text-white font-medium px-5 py-2.5 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              View Sales
            </Link>
          </div>
        </div>

        {/* Your Shops */}
        <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">Your Shops</h2>
            <span className="text-sm text-gray-500">{shops.length} {shops.length === 1 ? 'shop' : 'shops'}</span>
          </div>

          {shops.length > 0 ? (
            <div className="grid gap-4">
              {shops.map((shop) => (
                <Link
                  key={shop.id}
                  href={`/dashboard/shop/${shop.slug}`}
                  className="group flex items-center gap-4 p-4 rounded-xl bg-[#0a0a0a] border border-gray-800/50 hover:border-teal-500/30 transition-all duration-200"
                >
                  {/* Shop Icon */}
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center">
                    <span className="text-lg font-bold text-white">
                      {shop.name.charAt(0)}
                    </span>
                  </div>

                  {/* Shop Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white group-hover:text-teal-400 transition-colors truncate">
                      {shop.name}
                    </h3>
                    <p className="text-gray-500 text-sm truncate">
                    {shop.description || "No description"}
                  </p>
                  </div>

                  {/* Product Count */}
                  <div className="flex-shrink-0 text-right">
                    <p className="text-lg font-semibold text-white">{shop._count?.products || 0}</p>
                    <p className="text-xs text-gray-500">products</p>
                  </div>

                  {/* Arrow */}
                  <div className="flex-shrink-0">
                    <svg 
                      className="w-5 h-5 text-gray-600 group-hover:text-teal-400 transition-colors" 
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
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/50 mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-400 mb-2">No shops yet</h3>
              <p className="text-gray-600 mb-6">Create your first shop to start selling digital products</p>
              <Link
                href="/dashboard/create-shop"
                className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-white font-medium px-6 py-3 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Your First Shop
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
