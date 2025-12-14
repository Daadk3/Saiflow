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
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-teal-500/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link 
              href={`/shop/${product.shop.slug}`}
              className="inline-flex items-center gap-2 text-gray-400 hover:text-teal-400 transition-colors group"
            >
              <svg 
                className="w-5 h-5 transition-transform group-hover:-translate-x-1" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Back to {product.shop.name}</span>
            </Link>

            {/* Shop Logo */}
            <Link href={`/shop/${product.shop.slug}`} className="flex items-center gap-2">
              {product.shop.logo ? (
                <Image
                  src={product.shop.logo}
                  alt={product.shop.name}
                  width={32}
                  height={32}
                  className="rounded-lg"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center">
                  <span className="text-sm font-bold text-white">
                    {product.shop.name.charAt(0)}
                  </span>
                </div>
              )}
              <span className="text-white font-medium hidden sm:block">{product.shop.name}</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Product Detail */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Left Column - Product Image */}
          <div className="space-y-4">
            {/* Main Image */}
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-[#111111] border border-gray-800/50">
              {product.thumbnailUrl ? (
                <Image
                  src={product.thumbnailUrl}
                  alt={product.name}
                  fill
                  className="object-cover"
                  priority
                />
              ) : product.images && product.images.length > 0 ? (
                <Image
                  src={product.images[0]}
                  alt={product.name}
                  fill
                  className="object-cover"
                  priority
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-teal-500/80 to-cyan-600/80 flex flex-col items-center justify-center">
                  <svg className="w-24 h-24 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-white/40 text-lg mt-4 font-medium">Digital Product</span>
                </div>
              )}
            </div>

            {/* Thumbnail Gallery (if multiple images) */}
            {product.images && product.images.length > 1 && (
              <div className="grid grid-cols-4 gap-3">
                {product.images.slice(0, 4).map((image, index) => (
                  <div 
                    key={index}
                    className="relative aspect-square rounded-xl overflow-hidden bg-[#111111] border border-gray-800/50 hover:border-teal-500/50 transition-colors cursor-pointer"
                  >
                    <Image
                      src={image}
                      alt={`${product.name} - Image ${index + 1}`}
                      fill
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column - Product Info */}
          <div className="flex flex-col">
            {/* Product Name */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">
              {product.name}
            </h1>

            {/* Price */}
            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-4xl sm:text-5xl font-bold text-teal-400">
                ${Number(product.price).toFixed(2)}
              </span>
              <span className="text-gray-500 text-lg">USD</span>
            </div>

            {/* Buy Button - handles disabled state internally */}
            <div className="mt-8">
              <BuyButton productId={product.id} hasFile={!!product.fileUrl} />
            </div>

            {/* Secure Payment Badge - only show if file exists */}
            {product.fileUrl && (
              <div className="mt-4 flex items-center gap-2 text-gray-500 text-sm">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <span>Secure checkout</span>
              </div>
            )}

            {/* Divider */}
            <div className="my-8 h-px bg-gray-800" />

            {/* Description */}
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">About this product</h2>
              <div className="prose prose-invert prose-gray max-w-none">
                <p className="text-gray-400 leading-relaxed whitespace-pre-wrap">
                  {product.description || "No description available."}
                </p>
              </div>
            </div>

            {/* What's Included */}
            <div className="mt-8 p-6 rounded-2xl bg-[#111111] border border-gray-800/50">
              <h2 className="text-lg font-semibold text-white mb-4">What&apos;s included</h2>
              <ul className="space-y-3">
                <li className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-teal-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Instant digital download</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-teal-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Lifetime access to file</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-teal-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Free updates included</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-800/50 mt-16">
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
              © {new Date().getFullYear()} {product.shop.name}. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
