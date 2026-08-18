import { cache } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SAFE_DELIVERABLE_WHERE } from "@/lib/file-safety";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import ShareButton from "@/components/ShareButton";
import { getLocale, getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/formatPrice";

const BASE_URL = "https://www.saiflow.io";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
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

// cache(): deduplicates the query between generateMetadata and the page render
const getShop = cache(async function getShop(slug: string): Promise<Shop | null> {
  const shop = await prisma.shop.findUnique({
    where: { slug },
    include: {
      products: {
        // Stage E2: publication AND deliverable safety, kept separate.
        where: {
          isActive: true,
          moderationStatus: "APPROVED",
          ...SAFE_DELIVERABLE_WHERE,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  // Deactivated shops are not publicly viewable
  if (!shop || !shop.isActive) return null;
  return {
    ...shop,
    products: shop.products.map(p => ({
      ...p,
      price: Number(p.price),
    })),
  };
});

// Per-storefront social metadata: canonical + OG + Twitter card so shared
// shop links preview as the seller's store, not the generic homepage.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getShop(slug);
  if (!shop) return {};

  const url = `${BASE_URL}/shop/${slug}`;
  const title = `${shop.name} | Saiflow`;
  const description =
    shop.description?.slice(0, 160) || `${shop.name} — digital products on Saiflow`;
  const image = shop.coverImage || shop.logo || `${BASE_URL}/og-image.png`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "Saiflow",
      type: "website",
      images: [{ url: image }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
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

  const locale = await getLocale();
  const t = await getTranslations();

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
                alt={t('storefront.productDetail.shopLogoAlt', { shopName: shop.name })}
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
            <h1 className="text-3xl font-bold text-white mt-4"><bdi>{shop.name}</bdi></h1>

            {/* Description */}
            {shop.description && (
              <p className="text-gray-400 mt-2 max-w-2xl">
                <bdi>{shop.description}</bdi>
              </p>
            )}

            {/* Stats */}
            <p className="text-sm text-gray-500 mt-3">
              {t('storefront.shopView.productsCount', { count: shop.products.length })}
            </p>

            {/* Permanent public link — share the storefront anywhere */}
            <div className="mt-4">
              <ShareButton title={shop.name} />
            </div>
          </div>
        </div>
      </header>

      {/* Products section */}
      <main className="bg-[#0a0a0a] py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">{t('storefront.shopView.productsHeading')}</h2>
            {shop.products.length > 0 && (
              <span className="text-sm text-gray-500">
                {t('storefront.shopView.showingProductsCount', { count: shop.products.length })}
              </span>
            )}
          </div>

          {shop.products.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {shop.products.map((product) => (
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
                    <div className="absolute top-3 end-3 bg-gray-900/80 px-3 py-1 rounded-full">
                      <span className="text-emerald-400 font-bold"><bdi>{formatPrice(Number(product.price), product.currency, locale)}</bdi></span>
                    </div>
                  </div>

                  {/* Product Info */}
                  <div className="p-5">
                    <h3 className="font-semibold text-white text-lg line-clamp-2 group-hover:text-teal-400 transition-colors">
                      <bdi>{product.name}</bdi>
                    </h3>

                    {product.description && (
                      <p className="mt-2 text-gray-400 text-sm line-clamp-2 leading-relaxed">
                        <bdi>{product.description}</bdi>
                      </p>
                    )}

                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-sm font-bold text-teal-400">
                        <bdi>{formatPrice(Number(product.price), product.currency, locale)}</bdi>
                      </span>
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-teal-400 group-hover:text-teal-300 transition-colors">
                        {t('products.viewProduct')}
                        <svg
                          className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
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
              <p className="text-gray-400 mt-4">{t('storefront.shopView.emptyState')}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
