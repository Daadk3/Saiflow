import { prisma } from "@/lib/prisma";
import { SAFE_DELIVERABLE_WHERE } from "@/lib/file-safety";
import {
  BuyerFlow,
  CategoriesGrid,
  CreatorValue,
  FeaturedProducts,
  FinalCta,
  Hero,
  SellSteps,
  TrustGrid,
  TwoPaths,
} from "@/components/home";
import type { FeaturedProduct } from "@/components/home";

// The featured grid must reflect what is sellable right now, never a build-time snapshot.
export const dynamic = "force-dynamic";

const FEATURED_LIMIT = 8;

/**
 * The newest products a visitor could actually buy. The visibility rule is
 * the same one the browse page, the storefront and checkout enforce: active,
 * approved by moderation, in an active shop, and with a deliverable that
 * passed the file-safety gate. Nothing unpublished can appear here.
 */
async function getFeaturedProducts(): Promise<FeaturedProduct[]> {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        moderationStatus: "APPROVED",
        shop: { isActive: true },
        // Stage E2. Publication and file safety are separate requirements and
        // are ANDed here, never merged: moderation decides whether a listing
        // may be shown, this decides whether its deliverable could actually be
        // bought. Spread from the canonical clause in lib/file-safety.ts so
        // this surface cannot drift from what checkout and download enforce.
        ...SAFE_DELIVERABLE_WHERE,
      },
      take: FEATURED_LIMIT,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        price: true,
        currency: true,
        thumbnailUrl: true,
        images: true,
        category: true,
        shop: {
          select: {
            slug: true,
            name: true,
          },
        },
      },
    });
    return products.map((p) => ({ ...p, price: Number(p.price) }));
  } catch (error) {
    // Don't let a DB hiccup take down the whole homepage — render with no
    // products (FeaturedProducts shows its empty state instead).
    console.error("Homepage: failed to load products, rendering without them.", error);
    return [];
  }
}

export default async function Home() {
  const products = await getFeaturedProducts();

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0a0a] text-white">
      {/* Subtle depth behind every section */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-gray-900/60 via-[#0a0a0a] to-[#0a0a0a]"
      />
      <div className="relative z-10">
        <Hero />
        <TwoPaths />
        <CategoriesGrid />
        <FeaturedProducts products={products} />
        <CreatorValue />
        <SellSteps />
        <BuyerFlow />
        <TrustGrid />
        <FinalCta />
      </div>
    </div>
  );
}
