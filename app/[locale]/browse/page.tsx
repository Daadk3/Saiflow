import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
  createdAt: Date;
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

type SortOption = "newest" | "popular" | "price-asc" | "price-desc";

async function getProducts(options: {
  category?: string;
  sort?: SortOption;
  minPrice?: number;
  maxPrice?: number;
}): Promise<Product[]> {
  const { category, sort = "newest", minPrice, maxPrice } = options;
  const where: { isActive: boolean; category?: string; price?: { gte?: number; lte?: number } } = {
    isActive: true,
  };

  if (category && categoryMap[category]) {
    where.category = category;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {};
    if (minPrice !== undefined) where.price.gte = minPrice;
    if (maxPrice !== undefined) where.price.lte = maxPrice;
  }

  const orderBy =
    sort === "price-asc"
      ? { price: "asc" as const }
      : sort === "price-desc"
      ? { price: "desc" as const }
      : { createdAt: "desc" as const }; // default / popular fallback

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
    orderBy,
  });

  return products.map((p) => ({
    ...p,
    price: Number(p.price),
  }));
}

interface BrowsePageProps {
  searchParams: Promise<{
    category?: string;
    sort?: SortOption;
    minPrice?: string;
    maxPrice?: string;
  }>;
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const params = await searchParams;
  const category = params.category;
  const sort = params.sort ?? "newest";
  const minPrice = params.minPrice ? Number(params.minPrice) : undefined;
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : undefined;

  const products = await getProducts({ category, sort, minPrice, maxPrice });
  const categoryName = category ? categoryMap[category] : "All Products";
  const productCount = products.length;
  const categories = Object.entries(categoryMap);

  return (
    <div className="bg-[#0a0a0a] min-h-screen text-white">
      {/* Header */}
      <section className="border-b border-gray-800 bg-[#0a0a0a] py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-teal-400 uppercase tracking-wide">Products</p>
              <h1 className="text-3xl font-bold text-white mt-2">
                {category ? categoryMap[category] ?? "Products" : "All Products"}
              </h1>
              <p className="text-gray-400 mt-2">Showing {productCount} products</p>
            </div>

            <form className="flex items-center gap-3" method="get">
              {category && <input type="hidden" name="category" value={category} />}
              {minPrice !== undefined && <input type="hidden" name="minPrice" value={minPrice} />}
              {maxPrice !== undefined && <input type="hidden" name="maxPrice" value={maxPrice} />}
              <label className="text-sm font-medium text-gray-300">Sort</label>
              <select
                name="sort"
                defaultValue={sort}
                className="rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-gray-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                <option value="newest">Newest</option>
                <option value="popular">Popular</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
              <button
                type="submit"
                className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition"
              >
                Apply
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-10">
            {/* Sidebar */}
            <aside className="w-full lg:w-64 lg:pr-8 lg:border-r lg:border-gray-800 space-y-8">
              {/* Mobile filters */}
              <div className="lg:hidden">
                <details className="border border-gray-800 rounded-xl p-4 bg-[#111111]">
                  <summary className="font-semibold text-white cursor-pointer">Filters</summary>
                  <div className="mt-4 space-y-6">
                    <div>
                      <h3 className="font-semibold text-white mb-3">Categories</h3>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href="/browse"
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                            !category
                              ? "bg-teal-500 text-white"
                              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                          }`}
                        >
                          All
                        </Link>
                        {categories.map(([slug, name]) => {
                          const query = new URLSearchParams();
                          query.set("category", slug);
                          query.set("sort", sort);
                          if (minPrice !== undefined) query.set("minPrice", String(minPrice));
                          if (maxPrice !== undefined) query.set("maxPrice", String(maxPrice));
                          return (
                            <Link
                              key={slug}
                              href={`/browse?${query.toString()}`}
                              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                category === slug
                                  ? "bg-teal-500 text-white"
                                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                              }`}
                            >
                              {name}
                            </Link>
                          );
                        })}
                      </div>
                    </div>

                    <form className="space-y-3" method="get">
                      {category && <input type="hidden" name="category" value={category} />}
                      {sort && <input type="hidden" name="sort" value={sort} />}
                      <h3 className="font-semibold text-white">Price range</h3>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          name="minPrice"
                          placeholder="Min"
                          defaultValue={minPrice ?? ""}
                          className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                        <span className="text-gray-500">—</span>
                        <input
                          type="number"
                          name="maxPrice"
                          placeholder="Max"
                          defaultValue={maxPrice ?? ""}
                          className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition"
                      >
                        Apply filters
                      </button>
                    </form>

                    <Link
                      href="/browse"
                      className="inline-flex items-center gap-2 text-sm font-medium text-teal-400 hover:text-teal-300"
                    >
                      Clear filters
                    </Link>
                  </div>
                </details>
              </div>

              {/* Desktop filters */}
              <div className="hidden lg:block sticky top-24 space-y-8">
                <div>
                  <h3 className="font-semibold text-white mb-3">Categories</h3>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/browse"
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                        !category
                          ? "bg-teal-500 text-white"
                          : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      All
                    </Link>
                    {categories.map(([slug, name]) => {
                      const query = new URLSearchParams();
                      query.set("category", slug);
                      query.set("sort", sort);
                      if (minPrice !== undefined) query.set("minPrice", String(minPrice));
                      if (maxPrice !== undefined) query.set("maxPrice", String(maxPrice));
                      return (
                        <Link
                          key={slug}
                          href={`/browse?${query.toString()}`}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                            category === slug
                              ? "bg-teal-500 text-white"
                              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                          }`}
                        >
                          {name}
                        </Link>
                      );
                    })}
                  </div>
                </div>

                <form className="space-y-3" method="get">
                  {category && <input type="hidden" name="category" value={category} />}
                  {sort && <input type="hidden" name="sort" value={sort} />}
                  <h3 className="font-semibold text-white mb-1">Price range</h3>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      name="minPrice"
                      placeholder="Min"
                      defaultValue={minPrice ?? ""}
                      className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                    <span className="text-gray-500">—</span>
                    <input
                      type="number"
                      name="maxPrice"
                      placeholder="Max"
                      defaultValue={maxPrice ?? ""}
                      className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition"
                  >
                    Apply filters
                  </button>
                  <Link
                    href="/browse"
                    className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-800"
                  >
                    Clear filters
                  </Link>
                </form>
              </div>
            </aside>

            {/* Products */}
            <div className="flex-1">
              {products.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {products.map((product, index) => (
                    <Link
                      key={product.id}
                      href={`/shop/${product.shop.slug}/product/${product.slug}`}
                      className="product-card group bg-[#111111] rounded-2xl border border-gray-800 hover:border-gray-700 transition-all duration-300 hover:-translate-y-1 overflow-visible"
                    >
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
                        {!product.fileUrl && (
                          <div className="absolute top-3 left-3">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Coming Soon
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-5">
                        <h3 className="font-semibold text-white text-lg line-clamp-2 group-hover:text-teal-400 transition-colors">
                          {product.name}
                        </h3>
                        <div className="text-sm text-gray-500 mt-1">{product.shop.name}</div>
                        {product.description && (
                          <p className="mt-2 text-gray-400 text-sm line-clamp-2">{product.description}</p>
                        )}
                        {product.category && (
                          <span className="inline-block px-3 py-1 bg-gray-800 text-gray-300 text-xs font-medium rounded-full mt-3">
                            {categoryMap[product.category] || "Digital Product"}
                          </span>
                        )}
                        <div className="text-teal-400 font-bold text-xl mt-3">
                          ${Number(product.price).toFixed(2)}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 border border-dashed border-gray-800 rounded-2xl bg-[#111111]">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-800 mb-6">
                    <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-white">No products found</h3>
                  <p className="mt-2 text-gray-400">Try adjusting your filters or browse everything available.</p>
                  <div className="mt-6">
                    <Link
                      href="/browse"
                      className="inline-flex items-center gap-2 rounded-full bg-teal-500 px-6 py-3 text-white font-semibold hover:bg-teal-600 transition"
                    >
                      Browse all products
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0-4 4m4-4H3" />
                      </svg>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
