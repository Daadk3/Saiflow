import { prisma } from "@/lib/prisma";
import {
  HeroSection,
  StatsSection,
  CategoriesSection,
  TrendingProductsSection,
  FeaturesSection,
  PlatformSection,
  CTASection,
} from "@/components/home";
import TrustBadges from "@/components/TrustBadges";

export default async function Home() {
  const products = await prisma.product.findMany({
    take: 8,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      thumbnailUrl: true,
      images: true,
      shop: {
        select: {
          slug: true,
          name: true,
        },
      },
    },
  });

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] overflow-hidden">
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-[#0a0a0a] to-gray-900" />
      
      {/* Subtle glow orbs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 right-0 w-64 h-64 bg-teal-400/5 rounded-full blur-2xl pointer-events-none" />
      
      {/* Subtle diagonal light streaks */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent pointer-events-none" />
      
      {/* Content with relative positioning */}
      <div className="relative z-10 pt-16">
        <HeroSection />
        <StatsSection />
        <CategoriesSection />
        <TrendingProductsSection products={products} />
        <FeaturesSection />
        <PlatformSection />
        <section className="container mx-auto px-4 py-8 bg-[#0a0a0a]">
          <TrustBadges />
        </section>
        <CTASection />
      </div>
    </div>
  );
}
