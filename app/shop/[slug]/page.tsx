import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  images: string[];
  thumbnailUrl: string | null;
}

interface Shop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
  coverImage: string | null;
  products: Product[];
}

async function getShop(slug: string): Promise<Shop | null> {
  const shop = await prisma.shop.findUnique({
    where: { slug },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!shop) return null;
  return {
    ...shop,
    products: shop.products.map(p => ({
      ...p,
      price: Number(p.price),
    })),
  };
}

export default async function PublicShopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const shop = await getShop(slug);

  if (!shop) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="text-xl font-bold text-white">Saiflow</span>
            </Link>

            {/* Nav Links */}
            <div className="flex items-center gap-4">
              <Link href="/browse" className="text-gray-400 hover:text-white transition-colors text-sm">
                All Products
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Header */}
      <header className="relative overflow-hidden pt-16">
        {/* Background - Cover Image or Pattern */}
        {shop.coverImage ? (
          <div className="absolute inset-0">
            <Image
              src={shop.coverImage}
              alt={`${shop.name} cover`}
              fill
              className="object-cover"
              priority
            />
            {/* Dark overlay for readability */}
            <div className="absolute inset-0 bg-black/60" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-black/30" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0a] via-[#0a1a1a] to-[#0d1f1f]">
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-0 left-1/4 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
            </div>
            {/* Grid overlay */}
            <div 
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                backgroundSize: '50px 50px'
              }}
            />
          </div>
        )}

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="text-center">
            {/* Shop Logo */}
            {shop.logo ? (
              <div className="mb-6 inline-block">
                <Image
                  src={shop.logo}
                  alt={shop.name}
                  width={80}
                  height={80}
                  className="rounded-2xl ring-2 ring-teal-500/20"
                />
              </div>
            ) : (
              <div className="mb-6 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 ring-2 ring-teal-500/20">
                <span className="text-3xl font-bold text-white">
                  {shop.name.charAt(0)}
                </span>
              </div>
            )}

            {/* Shop Name */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight">
              {shop.name}
            </h1>

            {/* Description */}
            {shop.description && (
              <p className="mt-4 text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
                {shop.description}
              </p>
            )}

            {/* Stats */}
            <div className="mt-8 flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{shop.products.length}</div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Products</div>
              </div>
              <div className="w-px h-10 bg-gray-700" />
              <div className="text-center">
                <div className="text-2xl font-bold text-teal-400">Digital</div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Downloads</div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#0a0a0a] to-transparent" />
      </header>

      {/* Products Section */}
      <main className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Section Header */}
        <div className="flex items-center gap-4 mb-10">
          <h2 className="text-2xl font-semibold text-white">All Products</h2>
          <div className="flex-1 h-px bg-gradient-to-r from-gray-700 to-transparent" />
        </div>

        {shop.products.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {shop.products.map((product, index) => (
              <Link
                key={product.id}
                href={`/shop/${shop.slug}/product/${product.slug}`}
                className="group relative bg-[#111111] rounded-2xl overflow-hidden border border-gray-800/50 hover:border-teal-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-teal-500/10"
              >
                {/* Product Image */}
                <div className="relative aspect-[4/3] overflow-hidden">
                  {product.thumbnailUrl ? (
                    <Image
                      src={product.thumbnailUrl}
                      alt={product.name}
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : product.images && product.images.length > 0 ? (
                    <Image
                      src={product.images[0]}
                      alt={product.name}
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div 
                      className="absolute inset-0 flex flex-col items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, 
                          hsl(${175 + (index * 15) % 30}, 70%, ${35 - (index * 3) % 10}%) 0%, 
                          hsl(${185 + (index * 10) % 25}, 80%, ${25 - (index * 2) % 8}%) 100%)`
                      }}
                    >
                      <svg className="w-16 h-16 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="text-white/30 text-sm mt-2 font-medium">Digital Product</span>
                    </div>
                  )}
                  
                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  {/* Price Badge */}
                  <div className="absolute top-3 right-3">
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-black/70 backdrop-blur-sm text-white border border-white/10">
                      ${Number(product.price).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Product Info */}
                <div className="p-5">
                  <h3 className="font-semibold text-lg text-white group-hover:text-teal-400 transition-colors duration-200">
                    {product.name}
                  </h3>
                  
                  {product.description && (
                    <p className="mt-2 text-gray-500 text-sm line-clamp-2 leading-relaxed">
                      {product.description}
                    </p>
                  )}

                  {/* CTA */}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-gray-600 uppercase tracking-wider">
                      Digital Download
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-teal-400 group-hover:text-teal-300 transition-colors">
                      View
                      <svg 
                        className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/50 mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-400">No products yet</h3>
            <p className="mt-1 text-gray-600">Check back soon for new releases.</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <div className="w-5 h-5 rounded bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
              </div>
              Powered by <span className="text-gray-400 font-medium">Saiflow</span>
            </div>
            <div className="text-gray-600 text-sm">
              © {new Date().getFullYear()} {shop.name}. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
