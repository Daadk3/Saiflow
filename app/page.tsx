import { prisma } from "@/lib/prisma";
import {
  HeroSection,
  StatsSection,
  CategoriesSection,
  TrendingProductsSection,
  FeaturesSection,
  CTASection,
} from "@/components/home";

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
    <div className="pt-16 bg-white">
      <HeroSection />
      <StatsSection />
      <CategoriesSection />
      <TrendingProductsSection products={products} />
      <FeaturesSection />
      <CTASection />
    </div>
  );
}
