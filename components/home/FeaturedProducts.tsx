import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { isProductCategory } from "@/lib/categories";
import { ProductCard } from "@/components/ProductCard";
import type { ProductCardProduct } from "@/components/ProductCard";
import { SectionHeading } from "./SectionHeading";
import { IconStore } from "./icons";

/** A sellable product as the homepage query selects it. Price already a number. */
export interface FeaturedProduct extends ProductCardProduct {
  category: string | null;
}

interface FeaturedProductsProps {
  products: FeaturedProduct[];
}

export async function FeaturedProducts({ products }: FeaturedProductsProps) {
  const t = await getTranslations("home.featured");
  const tCategories = await getTranslations("home.categories");
  const locale = await getLocale();

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          title={t("title")}
          subtitle={t("subtitle")}
          action={products.length > 0 ? { href: "/browse", label: t("viewAll") } : undefined}
        />

        {products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-800 bg-[#0f0f0f] px-6 py-14 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-300">
              <IconStore className="h-7 w-7" />
            </div>
            <h3 className="text-2xl font-semibold text-white">{t("emptyTitle")}</h3>
            <p className="mx-auto mt-3 max-w-md text-gray-400">{t("emptyBody")}</p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/signup" className="btn-primary">
                {t("emptyCta")}
              </Link>
              <Link href="/browse" className="btn-secondary">
                {t("emptyBrowse")}
              </Link>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((product) => (
              <li key={product.id} className="flex">
                <ProductCard
                  product={product}
                  locale={locale}
                  categoryLabel={isProductCategory(product.category) ? tCategories(product.category) : null}
                  byShopLabel={t("byShop", { shop: product.shop.name })}
                  viewLabel={t("viewProduct")}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
