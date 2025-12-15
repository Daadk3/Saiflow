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
  category: string | null;
  shop: {
    name: string;
    slug: string;
  };
}

const categoryMap: Record<string, string> = {
  ebooks: "eBooks & Guides",
  courses: "Online Courses",
  templates: "Templates & Themes",
  music: "Music & Audio",
  art: "Art & Graphics",
  software: "Software & Apps",
};

async function getProducts(category?: string): Promise<Product[]> {
  const where: { isActive: boolean; category?: string } = { isActive: true };
  
  if (category && categoryMap[category]) {
    where.category = category;
  }

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      images: true,
      thumbnailUrl: true,
      fileUrl: true,
      category: true,
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

interface BrowsePageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const params = await searchParams;
  const category = params.category;
  const products = await getProducts(category);
  const categoryName = category ? categoryMap[category] : null;

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
              {categoryName ? categoryName : "Browse Products"}
            </h1>
            <p className="mt-4 text-gray-400 text-lg max-w-2xl mx-auto">
              {categoryName 
                ? `Discover amazing ${categoryName.toLowerCase()} from creators`
                : "Discover amazing digital products from creators"}
            </p>
            {categoryName && (
              <div className="mt-6">
                <Link
                  href="/browse"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear filter
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Category Filter Tabs */}
      {!categoryName && (
        <section className="pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap gap-3 justify-center">
              {Object.entries(categoryMap).map(([slug, name]) => (
                <Link
                  key={slug}
                  href={`/browse?category=${slug}`}
                  className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  {name}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Products Grid */}
      <section className="pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {products.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((product, index) => (
                <Link
                  key={product.id}
                  href={`/shop/${product.shop.slug}/product/${product.slug}`}
                  className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 hover:-translate-y-1"
                >
                  {/* Product Image */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
                    {product.thumbnailUrl ? (
                      <Image
                        src={product.thumbnailUrl}
                        alt={product.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : product.images && product.images.length > 0 ? (
                      <Image
                        src={product.images[0]}
                        alt={product.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div 
                        className="absolute inset-0 flex flex-col items-center justify-center text-gray-700 text-sm font-semibold"
                        style={{
                          background: `linear-gradient(135deg, 
                            hsl(${175 + (index * 15) % 30}, 70%, ${75 - (index * 3) % 10}%) 0%, 
                            hsl(${185 + (index * 10) % 25}, 80%, ${70 - (index * 2) % 8}%) 100%)`
                        }}
                      >
                        Digital Product
                      </div>
                    )}
                    
                    {/* Price Badge */}
                    <div className="absolute top-3 right-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-white/90 backdrop-blur-sm text-gray-900">
                        ${Number(product.price).toFixed(2)}
                      </span>
                    </div>
                    
                    {/* Coming Soon Badge */}
                    {!product.fileUrl && (
                      <div className="absolute top-3 left-3">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
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
                    <h3 className="font-semibold text-gray-900 text-lg line-clamp-2 group-hover:text-teal-600 transition-colors">
                      {product.name}
                    </h3>
                    <div className="text-sm text-gray-500 mt-1">{product.shop.name}</div>
                    {product.description && (
                      <p className="mt-2 text-gray-600 text-sm line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    {product.category && (
                      <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full mt-3">
                        {categoryMap[product.category] || "Digital Product"}
                      </span>
                    )}
                    <div className="text-teal-600 font-bold text-xl mt-3">
                      ${Number(product.price).toFixed(2)}
                    </div>
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
              <h3 className="text-xl font-semibold text-gray-300">
                {categoryName ? `No products found in ${categoryName}` : "No products yet"}
              </h3>
              <p className="mt-2 text-gray-600 max-w-md mx-auto">
                {categoryName 
                  ? `Check back soon for ${categoryName.toLowerCase()}!`
                  : "Check back soon for amazing digital products!"}
              </p>
              {categoryName ? (
                <Link
                  href="/browse"
                  className="mt-6 inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 font-medium"
                >
                  Browse all products
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              ) : (
                <Link
                  href="/signup"
                  className="mt-6 inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 font-medium"
                >
                  Be the first to sell
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              )}
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
