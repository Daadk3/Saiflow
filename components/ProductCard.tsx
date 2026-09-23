import Link from "next/link";
import { formatPrice } from "@/lib/formatPrice";
import { isProductCategory } from "@/lib/categories";
import type { ProductCategory } from "@/lib/categories";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import {
  IconArrow,
  IconBook,
  IconCode,
  IconImage,
  IconMusic,
  IconPalette,
  IconPlay,
  IconTemplate,
} from "@/components/home/icons";

/**
 * The one product card every public listing uses: the homepage's featured
 * grid and the browse marketplace. The whole card is a single link to the
 * canonical product route; the "view product" text is a visual cue inside it.
 * Callers resolve the labels, so this stays a plain server component.
 */
export interface ProductCardProduct {
  id: string;
  name: string;
  slug: string;
  /** Already a number: Prisma's Decimal is converted by the caller. */
  price: number;
  currency: string;
  thumbnailUrl: string | null;
  images: string[];
  /** The stored taxonomy slug; drives the thumbnail fallback. */
  category: string | null;
  shop: {
    name: string;
    slug: string;
  };
}

interface ProductCardProps {
  product: ProductCardProduct;
  locale: string;
  /** The category chip, already translated; null hides it. */
  categoryLabel: string | null;
  /** "by {shop}", already interpolated. */
  byShopLabel: string;
  viewLabel: string;
}

const THUMBNAIL_SIZES = "(min-width: 1536px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

/** A category-tinted tile with the category's icon, used when there is no usable thumbnail. */
const FALLBACK: Record<ProductCategory, { Icon: (p: { className?: string }) => React.JSX.Element; tone: string }> = {
  ebooks: { Icon: IconBook, tone: "from-blue-500/25 to-blue-900/10 text-blue-200" },
  courses: { Icon: IconPlay, tone: "from-purple-500/25 to-purple-900/10 text-purple-200" },
  templates: { Icon: IconTemplate, tone: "from-orange-500/25 to-orange-900/10 text-orange-200" },
  art: { Icon: IconPalette, tone: "from-pink-500/25 to-pink-900/10 text-pink-200" },
  music: { Icon: IconMusic, tone: "from-teal-500/25 to-teal-900/10 text-teal-200" },
  software: { Icon: IconCode, tone: "from-emerald-500/25 to-emerald-900/10 text-emerald-200" },
};

function ThumbnailFallback({ category }: { category: string | null }) {
  const match = isProductCategory(category) ? FALLBACK[category] : null;
  const Icon = match?.Icon ?? IconImage;
  const tone = match?.tone ?? "from-gray-800/60 to-gray-900/30 text-gray-500";
  return (
    <div aria-hidden="true" className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${tone}`}>
      <Icon className="h-12 w-12" />
    </div>
  );
}

export function ProductCard({ product, locale, categoryLabel, byShopLabel, viewLabel }: ProductCardProps) {
  const image = product.thumbnailUrl || product.images[0] || null;
  const initial = product.shop.name.trim().charAt(0);

  return (
    <Link
      href={`/shop/${product.shop.slug}/product/${product.slug}`}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-gray-800 bg-[#111111] transition hover:-translate-y-0.5 hover:border-teal-500/40 hover:shadow-lg hover:shadow-black/40"
    >
      {/* Fixed 4:3 frame: every card in a row is the same height. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#0d0d0d]">
        <ProductThumbnail src={image} sizes={THUMBNAIL_SIZES} fallback={<ThumbnailFallback category={product.category} />} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 min-h-[2.75rem] text-base font-semibold leading-snug text-white">
          <bdi>{product.name}</bdi>
        </h3>
        <div className="flex items-center justify-between gap-2 text-sm text-gray-400">
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs font-bold text-teal-300"
            >
              {initial}
            </span>
            <span className="truncate">{byShopLabel}</span>
          </span>
          {categoryLabel && (
            <span className="shrink-0 rounded-full border border-gray-800 bg-[#0d0d0d] px-2 py-0.5 text-xs font-medium text-gray-400">
              {categoryLabel}
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-800/80 pt-3">
          <span className="text-base font-bold text-teal-400">
            <bdi>{formatPrice(product.price, product.currency, locale)}</bdi>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-300 transition-colors group-hover:text-teal-300">
            {viewLabel}
            <IconArrow className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </span>
        </div>
      </div>
    </Link>
  );
}
