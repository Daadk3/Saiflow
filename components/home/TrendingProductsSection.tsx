import Link from "next/link";
import Image from "next/image";

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number | { toString(): string };
  thumbnailUrl: string | null;
  images: string[];
  shop: {
    slug: string;
    name: string;
  };
}

interface TrendingProductsSectionProps {
  products: Product[];
}

export function TrendingProductsSection({ products }: TrendingProductsSectionProps) {
  return (
    <section className="py-16 sm:py-24 px-4 bg-[#0a0a0a]">
      <div className="max-w-full px-4 sm:px-8 lg:px-16 xl:px-24 mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-3">
              Trending Products
            </h2>
            <p className="text-lg text-gray-400">
              Discover what creators are launching right now.
            </p>
          </div>
          <Link
            href="/browse"
            className="inline-flex items-center gap-2 rounded-full border border-teal-500/40 px-5 py-2 text-sm font-semibold text-teal-300 transition-colors hover:bg-teal-500 hover:text-black"
          >
            Browse All Products
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>

        {products.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#111111] p-10 text-center text-gray-400">
            Products coming soon! Be the first to sell.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
            {products.map((product, index) => {
              const image =
                product.thumbnailUrl ||
                (product.images && product.images.length > 0 ? product.images[0] : null);
              const href = `/shop/${product.shop.slug}/product/${product.slug}`;
              return (
                <Link
                  key={product.id}
                  href={href}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#111111] transition-transform duration-200 hover:-translate-y-1 hover:border-teal-500/50"
                >
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-cyan-500/5 to-emerald-500/10 blur-3xl" />
                  </div>
                  <div className="relative">
                    <div className="relative w-full h-64 overflow-hidden rounded-t-2xl bg-gray-900 flex items-center justify-center">
                      {image ? (
                        <Image
                          src={image}
                          alt={product.name}
                          width={400}
                          height={300}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div
                          className="absolute inset-0 flex items-center justify-center text-white/60 text-lg font-semibold"
                          style={{
                            background: `linear-gradient(135deg,
                              hsl(${175 + (index * 15) % 30}, 70%, ${35 - (index * 3) % 10}%) 0%,
                              hsl(${185 + (index * 10) % 25}, 80%, ${25 - (index * 2) % 8}%) 100%)`,
                          }}
                        >
                          Digital Product
                        </div>
                      )}
                    </div>
                    <div className="p-5 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold text-white line-clamp-2">
                          {product.name}
                        </h3>
                        <span className="whitespace-nowrap rounded-full bg-teal-500/15 px-3 py-1 text-sm font-semibold text-teal-300 border border-teal-500/30">
                          ${Number(product.price).toFixed(2)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">by {product.shop.name}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
