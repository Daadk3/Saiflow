import { cache } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import BuyButton from "./BuyButton";
import ReportProduct from "./ReportProduct";
import ShareButton from "@/components/ShareButton";
import { getLocale, getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/formatPrice";
import { env } from "@/lib/env";

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
  fileUrl: string | null;
  shop: {
    name: string;
    slug: string;
    logo: string | null;
  };
}

// cache(): deduplicates the query between generateMetadata and the page render
const getProduct = cache(async function getProduct(shopSlug: string, productSlug: string): Promise<Product | null> {
  const product = await prisma.product.findFirst({
    where: {
      slug: productSlug,
      // Unpublished / unapproved products and deactivated shops are not publicly viewable
      isActive: true,
      moderationStatus: "APPROVED",
      shop: {
        slug: shopSlug,
        isActive: true,
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      currency: true,
      images: true,
      thumbnailUrl: true,
      fileUrl: true,
      shop: {
        select: {
          name: true,
          slug: true,
          logo: true,
        },
      },
    },
  });
  if (!product) return null;
  return {
    ...product,
    price: Number(product.price),
  };
});

// Per-product social metadata: canonical URL + Open Graph + Twitter card so
// WhatsApp / LinkedIn / X previews show the product, not the generic homepage.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const product = await getProduct(slug, productSlug);
  if (!product) return {};

  const url = `${BASE_URL}/shop/${slug}/product/${productSlug}`;
  const title = `${product.name} — ${product.shop.name}`;
  const description =
    product.description?.slice(0, 160) ||
    `${product.name} — ${product.shop.name} on Saiflow`;
  const image = product.thumbnailUrl || `${BASE_URL}/og-image.png`;

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

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}) {
  const { slug, productSlug } = await params;
  const product = await getProduct(slug, productSlug);

  if (!product) {
    notFound();
  }

  const locale = await getLocale();
  const t = await getTranslations();
  const preLaunchMode = env.PRE_LAUNCH_MODE;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="border-b border-gray-800 bg-[#0a0a0a]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link
            href={`/shop/${product.shop.slug}`}
            className="inline-flex items-center gap-2 text-gray-500 hover:text-teal-600 transition-colors group"
          >
            <svg
              className="w-5 h-5 transition-transform group-hover:-translate-x-1 rtl:rotate-180 rtl:group-hover:translate-x-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0 7-7m-7 7h18" />
            </svg>
            <span className="text-sm font-medium text-gray-300">
              {t.rich("storefront.productDetail.backToStore", {
                shopName: product.shop.name,
                name: (chunks) => <bdi>{chunks}</bdi>,
              })}
            </span>
          </Link>

          <Link href={`/shop/${product.shop.slug}`} className="flex items-center gap-2">
            {product.shop.logo ? (
              <Image
                src={product.shop.logo}
                alt={t("storefront.productDetail.shopLogoAlt", { shopName: product.shop.name })}
                width={32}
                height={32}
                className="rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center font-semibold">
                {product.shop.name.charAt(0)}
              </div>
            )}
            <span className="text-white font-medium hidden sm:block"><bdi>{product.shop.name}</bdi></span>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-10 lg:gap-12">
          {/* Left column */}
          <div>
            {/* Preview */}
            <div className="rounded-2xl overflow-hidden shadow-lg bg-gray-800 flex items-center justify-center h-[360px] max-h-[480px]">
              {product.thumbnailUrl ? (
                <Image
                  src={product.thumbnailUrl}
                  alt=""
                  aria-hidden="true"
                  width={1200}
                  height={800}
                  className="max-h-full w-auto object-contain"
                  priority
                />
              ) : product.images && product.images.length > 0 ? (
                <Image
                  src={product.images[0]}
                  alt=""
                  aria-hidden="true"
                  width={1200}
                  height={800}
                  className="max-h-full w-auto object-contain"
                  priority
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-500">
                  <svg className="w-16 h-16 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-sm font-medium">{t("storefront.productDetail.imagePlaceholder")}</span>
                </div>
              )}
            </div>

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl font-bold text-white mt-8"><bdi>{product.name}</bdi></h1>

            {/* Creator info */}
            <div className="flex items-center gap-3 mt-4">
              {product.shop.logo ? (
                <Image
                  src={product.shop.logo}
                  alt={product.shop.name}
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center font-semibold">
                  {product.shop.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="font-medium text-white"><bdi>{product.shop.name}</bdi></p>
                <p className="text-sm text-gray-500">{t("storefront.productDetail.digitalCreator")}</p>
              </div>
            </div>

            {/* Description */}
            <div className="prose prose-invert mt-8 max-w-none text-gray-300 leading-relaxed">
              <p className="whitespace-pre-wrap">
                <bdi>
                  {product.description || t("storefront.productDetail.descriptionEmptyState")}
                </bdi>
              </p>
            </div>

            {/* What's included */}
            <div className="mt-12 p-6 bg-[#111111] rounded-xl border border-gray-800">
              <h2 className="font-semibold text-white text-lg mb-4">{t("storefront.productDetail.whatsIncluded")}</h2>
              <ul className="space-y-3 text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <span className="text-teal-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  {t("storefront.productDetail.includesInstantDownload")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-teal-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  {t("storefront.productDetail.includesLifetimeAccess")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-teal-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  {t("storefront.productDetail.includesFreeUpdates")}
                </li>
              </ul>
            </div>
          </div>

          {/* Right column - purchase card */}
          <aside className="lg:ps-4">
            <div className="sticky top-24 bg-[#111111] border border-gray-800 rounded-2xl p-6 shadow-lg">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-white">
                  <bdi>{formatPrice(Number(product.price), product.currency, locale)}</bdi>
                </span>
              </div>

              <div className="mt-6">
                <BuyButton productId={product.id} hasFile={!!product.fileUrl} preLaunchMode={preLaunchMode} />
              </div>

              <div className="mt-3 flex justify-center">
                <ShareButton title={product.name} />
              </div>

              <p className="text-center text-sm text-gray-500 mt-4">
                {t("storefront.productDetail.secureCheckout")}
              </p>

              {product.fileUrl && (
                <div className="mt-4 flex items-center gap-2 text-xs text-gray-500 justify-center">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t("storefront.productDetail.paymentsProcessedSecurely")}
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* Trust & Safety: public reporting — quiet link, human review, never auto-removal */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 lg:pb-8">
          <ReportProduct productId={product.id} />
        </div>
      </main>

      {/* Mobile sticky bar */}
      <div className="fixed bottom-0 start-0 end-0 bg-[#111111] border-t border-gray-800 p-4 lg:hidden flex items-center justify-between z-50">
        <div>
          <p className="text-xs text-gray-400">{t("storefront.productDetail.getThisProduct")}</p>
          <p className="text-lg font-bold text-white">
            <bdi>{formatPrice(Number(product.price), product.currency, locale)}</bdi>
          </p>
        </div>
        <div className="flex-1 ps-4">
          <BuyButton productId={product.id} hasFile={!!product.fileUrl} preLaunchMode={preLaunchMode} />
        </div>
      </div>
    </div>
  );
}
