import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ProductCategory } from "@/lib/categories";
import { SectionHeading } from "./SectionHeading";
import { IconBook, IconCode, IconMusic, IconPalette, IconPlay, IconTemplate } from "./icons";

/** Slugs are the taxonomy in lib/categories.ts; the browse page filters on them. */
const CATEGORIES: ReadonlyArray<{
  slug: ProductCategory;
  Icon: (p: { className?: string }) => React.JSX.Element;
  tone: string;
}> = [
  { slug: "ebooks", Icon: IconBook, tone: "border-blue-500/20 bg-blue-500/10 text-blue-300 group-hover:border-blue-400/60" },
  { slug: "courses", Icon: IconPlay, tone: "border-purple-500/20 bg-purple-500/10 text-purple-300 group-hover:border-purple-400/60" },
  { slug: "templates", Icon: IconTemplate, tone: "border-orange-500/20 bg-orange-500/10 text-orange-300 group-hover:border-orange-400/60" },
  { slug: "art", Icon: IconPalette, tone: "border-pink-500/20 bg-pink-500/10 text-pink-300 group-hover:border-pink-400/60" },
  { slug: "music", Icon: IconMusic, tone: "border-teal-500/20 bg-teal-500/10 text-teal-300 group-hover:border-teal-400/60" },
  { slug: "software", Icon: IconCode, tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300 group-hover:border-emerald-400/60" },
];

export async function CategoriesGrid() {
  const t = await getTranslations("home.categories");

  return (
    <section id="categories" className="scroll-mt-24 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading title={t("title")} subtitle={t("subtitle")} align="center" />
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map(({ slug, Icon, tone }) => (
            <li key={slug}>
              <Link
                href={`/browse?category=${slug}`}
                aria-label={t("browseAria", { category: t(slug) })}
                className="group flex h-full flex-col items-center gap-4 rounded-2xl border border-gray-800 bg-[#111111] px-4 py-7 text-center transition hover:-translate-y-1 hover:border-gray-700 hover:shadow-lg hover:shadow-black/40"
              >
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl border transition ${tone}`}>
                  <Icon className="h-7 w-7" />
                </span>
                <span className="text-base font-semibold text-white">{t(slug)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
