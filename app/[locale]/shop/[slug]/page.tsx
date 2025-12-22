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
      {/* Shop header */}
      <header className="bg-[#0a0a0a] border-b border-gray-800 py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center text-center">
            {/* Shop avatar */}
            {shop.logo ? (
              <Image
                src={shop.logo}
                alt={shop.name}
                width={80}
                height={80}
                className="w-20 h-20 rounded-2xl shadow-lg object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-teal-500 shadow-lg flex items-center justify-center text-3xl font-bold text-white">
                {shop.name.charAt(0)}
              </div>
            )}

            {/* Shop name */}
            <h1 className="text-3xl font-bold text-white mt-4">{shop.name}</h1>

            {/* Description */}
            {shop.description && (
              <p className="text-gray-400 mt-2 max-w-2xl">
                {shop.description}
              </p>
            )}

            {/* Stats */}
            <p className="text-sm text-gray-500 mt-3">
              {shop.products.length} {shop.products.length === 1 ? "product" : "products"}
            </p>
          </div>
        </div>
      </header>

      {/* Products section */}
      <main className="bg-[#0a0a0a] py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Products</h2>
            {shop.products.length > 0 && (
              <span className="text-sm text-gray-500">
                Showing {shop.products.length} {shop.products.length === 1 ? "product" : "products"}
              </span>
            )}
          </div>

          {shop.products.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {shop.products.map((product, index) => (
                <Link
                  key={product.id}
                  href={`/shop/${shop.slug}/product/${product.slug}`}
                  className="product-card group bg-[#111111] rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-800 hover:border-gray-700 hover:-translate-y-1 overflow-visible"
                >
                  {/* Product Image */}
                  <div className="relative w-full h-80 bg-gray-900 rounded-t-xl overflow-hidden flex items-center justify-center p-4">
                    <img
                      src={product.thumbnailUrl || (product.images && product.images.length > 0 ? product.images[0] : '/placeholder.png')}
                      alt=""
                      aria-hidden="true"
                      className="max-w-full max-h-full object-contain"
                      style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}
                    />
                    <div className="absolute top-3 right-3 bg-gray-900/80 px-3 py-1 rounded-full">
                      <span className="text-emerald-400 font-bold">${Number(product.price).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Product Info */}
                  <div className="p-5">
                    <h3 className="font-semibold text-white text-lg line-clamp-2 group-hover:text-teal-400 transition-colors">
                      {product.name}
                    </h3>

                    {product.description && (
                      <p className="mt-2 text-gray-400 text-sm line-clamp-2 leading-relaxed">
                        {product.description}
                      </p>
                    )}

                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-sm font-bold text-teal-400">
                        ${Number(product.price).toFixed(2)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-teal-400 group-hover:text-teal-300 transition-colors">
                        View product
                        <svg
                          className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0-4 4m4-4H3" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto text-gray-500">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
              <p className="text-gray-400 mt-4">No products yet. Check back soon for new releases.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
