import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import BuyButton from "./BuyButton";

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
    logo: string | null;
  };
}

async function getProduct(shopSlug: string, productSlug: string): Promise<Product | null> {
  const product = await prisma.product.findFirst({
    where: {
      slug: productSlug,
      shop: {
        slug: shopSlug,
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
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
              className="w-5 h-5 transition-transform group-hover:-translate-x-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0 7-7m-7 7h18" />
            </svg>
            <span className="text-sm font-medium text-gray-300">Back to {product.shop.name}</span>
          </Link>

          <Link href={`/shop/${product.shop.slug}`} className="flex items-center gap-2">
            {product.shop.logo ? (
              <Image
                src={product.shop.logo}
                alt={product.shop.name}
                width={32}
                height={32}
                className="rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center font-semibold">
                {product.shop.name.charAt(0)}
              </div>
            )}
            <span className="text-white font-medium hidden sm:block">{product.shop.name}</span>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-10 lg:gap-12">
          {/* Left column */}
          <div>
            {/* Preview */}
            <div className="rounded-2xl overflow-hidden shadow-lg aspect-video bg-gray-800 relative">
              {product.thumbnailUrl ? (
                <Image src={product.thumbnailUrl} alt={product.name} fill className="object-cover" priority />
              ) : product.images && product.images.length > 0 ? (
                <Image src={product.images[0]} alt={product.name} fill className="object-cover" priority />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                  <svg className="w-16 h-16 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-sm font-medium">Digital product preview</span>
                </div>
              )}
            </div>

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl font-bold text-white mt-8">{product.name}</h1>

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
                <p className="font-medium text-white">{product.shop.name}</p>
                <p className="text-sm text-gray-500">Digital creator</p>
              </div>
            </div>

            {/* Description */}
            <div className="prose prose-invert mt-8 max-w-none text-gray-300 leading-relaxed">
              <p className="whitespace-pre-wrap">
                {product.description || "This creator hasn’t added a description yet."}
              </p>
            </div>

            {/* What's included */}
            <div className="mt-12 p-6 bg-[#111111] rounded-xl border border-gray-800">
              <h2 className="font-semibold text-white text-lg mb-4">What&apos;s included</h2>
              <ul className="space-y-3 text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <span className="text-teal-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  Instant digital download
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-teal-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  Lifetime access to files
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-teal-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  Free updates from the creator
                </li>
              </ul>
            </div>
          </div>

          {/* Right column - purchase card */}
          <aside className="lg:pl-4">
            <div className="sticky top-24 bg-[#111111] border border-gray-800 rounded-2xl p-6 shadow-lg">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-white">
                  ${Number(product.price).toFixed(2)}
                </span>
                <span className="text-sm text-gray-500">USD</span>
              </div>

              <div className="mt-6">
                <BuyButton productId={product.id} hasFile={!!product.fileUrl} />
              </div>

              <p className="text-center text-sm text-gray-500 mt-4">
                Secure checkout. You&apos;ll get instant access after payment.
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
                  Payments are processed securely.
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* Mobile sticky bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#111111] border-t border-gray-800 p-4 lg:hidden flex items-center justify-between z-50">
        <div>
          <p className="text-xs text-gray-400">Get this product</p>
          <p className="text-lg font-bold text-white">
            ${Number(product.price).toFixed(2)}
          </p>
        </div>
        <div className="flex-1 pl-4">
          <BuyButton productId={product.id} hasFile={!!product.fileUrl} />
        </div>
      </div>
    </div>
  );
}
