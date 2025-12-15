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
    <section className="py-16 sm:py-20 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <p className="text-sm font-semibold text-teal-700 uppercase tracking-wide">
              Featured
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-1">
              Discover amazing products
            </h2>
            <p className="text-lg text-gray-600">
              Hand-picked digital products from top creators.
            </p>
          </div>
          <Link
            href="/browse"
            className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-800"
          >
            View all products →
          </Link>
        </div>

        {products.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-600">
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
                  className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="relative w-full h-56 overflow-hidden bg-gray-50 flex items-center justify-center">
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
                        className="absolute inset-0 flex items-center justify-center text-gray-700 text-sm font-semibold"
                        style={{
                          background: `linear-gradient(135deg,
                            hsl(${175 + (index * 15) % 30}, 70%, ${75 - (index * 3) % 10}%) 0%,
                            hsl(${185 + (index * 10) % 25}, 80%, ${70 - (index * 2) % 8}%) 100%)`,
                        }}
                      >
                        Digital Product
                      </div>
                    )}
                  </div>
                  <div className="p-5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-semibold text-gray-900 line-clamp-2">
                        {product.name}
                      </h3>
                      <span className="whitespace-nowrap rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700 border border-teal-100">
                        ${Number(product.price).toFixed(2)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">by {product.shop.name}</p>
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
