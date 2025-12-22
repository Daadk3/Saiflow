"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  thumbnailUrl: string | null;
  fileUrl: string | null;
  createdAt: string;
}

interface Shop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
  coverImage: string | null;
  createdAt: string;
  products: Product[];
}

export default function ShopDashboard() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }

    if (status === "authenticated" && slug) {
      fetchShop();
    }
  }, [status, slug, router]);

  async function fetchShop() {
    try {
      const res = await fetch(`/api/shops/${slug}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Shop not found");
        return;
      }

      setShop(data);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!confirm("Are you sure you want to delete this product?")) return;
    
    setDeletingProductId(productId);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setShop((prev) => prev ? {
          ...prev,
          products: prev.products.filter((p) => p.id !== productId),
        } : null);
      }
    } catch (err) {
      console.error("Error deleting product:", err);
    } finally {
      setDeletingProductId(null);
    }
  }

  // Calculate stats
  const totalProducts = shop?.products?.length || 0;

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-500"></div>
          <p className="text-gray-500">Loading shop...</p>
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
            <p className="text-red-500 mb-4">{error}</p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!shop) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Shop header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {shop.logo ? (
              <Image
                src={shop.logo}
                alt={shop.name}
                width={64}
                height={64}
                className="flex-shrink-0 w-16 h-16 rounded-2xl object-cover"
              />
            ) : (
              <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-teal-500 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">
                  {shop.name.charAt(0)}
                </span>
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold text-white">
                {shop.name}
              </h1>
              <p className="mt-1 text-gray-400">
                {shop.description || "No description"}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                <span className="font-mono bg-[#111111] px-2 py-1 rounded border border-gray-800">/shop/{shop.slug}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/dashboard/shop/${shop.slug}/add-product`}
              className="bg-teal-500 hover:bg-teal-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add product
            </Link>
            <Link
              href={`/shop/${shop.slug}`}
              target="_blank"
              className="bg-[#111111] border border-gray-800 hover:border-gray-700 text-gray-200 px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              View public shop
            </Link>
            <Link
              href={`/dashboard/shop/${shop.slug}/edit`}
              className="bg-[#111111] border border-gray-800 hover:border-gray-700 text-gray-200 px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              Edit shop
            </Link>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total products</p>
                <p className="text-3xl font-bold text-white mt-1">{totalProducts}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            </div>
          </div>
          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <p className="text-gray-400 text-sm">Total sales</p>
            <p className="text-3xl font-bold text-white mt-1">0</p>
            <p className="text-xs text-gray-500 mt-1">Coming soon</p>
          </div>
          <div className="bg-[#111111] p-6 rounded-xl border border-gray-800 shadow-sm">
            <p className="text-gray-400 text-sm">Total revenue</p>
            <p className="text-3xl font-bold text-white mt-1">$0.00</p>
            <p className="text-xs text-gray-500 mt-1">Coming soon</p>
          </div>
        </div>

        {/* Products section */}
        <div className="bg-[#111111] rounded-xl border border-gray-800 overflow-hidden">
          <div className="bg-[#0a0a0a] px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Products</h2>
            <span className="text-sm text-gray-500">
              {totalProducts} {totalProducts === 1 ? "product" : "products"}
            </span>
          </div>

          {shop.products && shop.products.length > 0 ? (
            <div className="grid gap-4">
              {shop.products.map((product) => (
                <div
                  key={product.id}
                  className="group flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-[#0a0a0a] border border-gray-800/50 hover:border-teal-500/30 transition-all duration-200"
                >
                  {/* Product Thumbnail */}
                  <div className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center border border-teal-500/10">
                    {product.thumbnailUrl ? (
                      <Image
                        src={product.thumbnailUrl}
                        alt={product.name}
                        width={56}
                        height={56}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white group-hover:text-teal-400 transition-colors">
                        {product.name}
                      </h3>
                      {!product.fileUrl && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          No file
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-sm mt-1 line-clamp-1">
                      {product.description || "No description"}
                    </p>
                    {!product.fileUrl ? (
                      <p className="text-xs text-amber-400/70 mt-1">
                        ⚠️ Upload a file to enable sales
                      </p>
                    ) : (
                      <p className="text-xs text-gray-600 mt-1 font-mono">
                        /{product.slug}
                      </p>
                    )}
                  </div>

                  {/* Price */}
                  <div className="flex-shrink-0">
                    <span className="text-xl font-bold text-teal-400">
                      ${Number(product.price).toFixed(2)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link
                      href={`/shop/${shop.slug}/product/${product.slug}`}
                      target="_blank"
                      className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                      title="View Product"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </Link>
                    <Link
                      href={`/dashboard/shop/${shop.slug}/product/${product.slug}/edit`}
                      className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                      title="Edit Product"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Link>
                    <button
                      onClick={() => handleDeleteProduct(product.id)}
                      disabled={deletingProductId === product.id}
                      className="p-2 rounded-lg bg-gray-800/50 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Delete Product"
                    >
                      {deletingProductId === product.id ? (
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/50 mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-400 mb-2">No products yet</h3>
              <p className="text-gray-600 mb-6">Add your first product to start selling</p>
              <Link
                href={`/dashboard/shop/${shop.slug}/add-product`}
                className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-white font-medium px-6 py-3 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Your First Product
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
