import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  images: string[];
  thumbnailUrl: string | null;
  fileUrl: string | null;
  shop: {
    name: string;
    slug: string;
  };
}

async function getProducts(): Promise<Product[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      images: true,
      thumbnailUrl: true,
      fileUrl: true,
      createdAt: true,
      shop: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return products.map(p => ({
    ...p,
    price: Number(p.price),
  }));
}

export default async function BrowsePage() {
  const products = await getProducts();

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
            <div className="hidden md:flex items-center gap-8">
              <Link href="/browse" className="text-white font-medium text-sm">
                Products
              </Link>
            </div>

            {/* Auth Buttons */}
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-gray-300 hover:text-white transition-colors text-sm font-medium px-4 py-2"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="bg-teal-500 hover:bg-teal-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Start Selling
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Header */}
      <section className="pt-32 pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-white">
              Browse Products
            </h1>
            <p className="mt-4 text-gray-400 text-lg max-w-2xl mx-auto">
              Discover amazing digital products from creators
            </p>
          </div>
        </div>
      </section>

      {/* Products Grid */}
      <section className="pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {products.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((product, index) => (
                <Link
                  key={product.id}
                  href={`/shop/${product.shop.slug}/product/${product.slug}`}
                  className="group relative bg-[#111111] rounded-2xl overflow-hidden border border-gray-800/50 hover:border-teal-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-teal-500/10"
                >
                  {/* Product Image */}
                  <div className="relative w-full h-64 overflow-hidden rounded-t-2xl bg-gray-900 flex items-center justify-center">
                    {product.thumbnailUrl ? (
                      <Image
                        src={product.thumbnailUrl}
                        alt={product.name}
                        width={400}
                        height={300}
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : product.images && product.images.length > 0 ? (
                      <Image
                        src={product.images[0]}
                        alt={product.name}
                        width={400}
                        height={300}
                        className="max-w-full max-h-full object-contain"
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
                    
                    {/* Price Badge */}
                    <div className="absolute top-3 right-3">
                      <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-black/70 backdrop-blur-sm text-white border border-white/10">
                        ${Number(product.price).toFixed(2)}
                      </span>
                    </div>
                    
                    {/* Coming Soon Badge */}
                    {!product.fileUrl && (
                      <div className="absolute top-3 left-3">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/90 text-black">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Coming Soon
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="p-5">
                    <div className="text-xs text-teal-400 font-medium mb-2">
                      {product.shop.name}
                    </div>
                    <h3 className="font-semibold text-lg text-white group-hover:text-teal-400 transition-colors duration-200">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="mt-2 text-gray-500 text-sm line-clamp-2">
                        {product.description}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-800/50 mb-6">
                <svg className="w-10 h-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-300">No products yet</h3>
              <p className="mt-2 text-gray-600 max-w-md mx-auto">
                Check back soon for amazing digital products!
              </p>
              <Link
                href="/signup"
                className="mt-6 inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 font-medium"
              >
                Be the first to sell
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="text-lg font-bold text-white">Saiflow</span>
            </div>
            <p className="text-gray-600 text-sm">
              © {new Date().getFullYear()} Saiflow. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
