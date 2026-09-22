import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/formatPrice";
import { IconArrow, IconImage } from "@/components/home/icons";

/**
 * The one product card every public listing uses: the homepage's featured
 * grid and the browse marketplace. The whole card is a single link to the
 * canonical product route; the "view product" text is a visual cue inside it.
 * Callers resolve the labels, so this stays a plain synchronous component.
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

export function ProductCard({ product, locale, categoryLabel, byShopLabel, viewLabel }: ProductCardProps) {
  const image = product.thumbnailUrl || product.images[0] || null;
  const initial = product.shop.name.trim().charAt(0);

  return (
    <Link
      href={`/shop/${product.shop.slug}/product/${product.slug}`}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-gray-800 bg-[#111111] transition hover:-translate-y-1 hover:border-teal-500/40 hover:shadow-xl hover:shadow-black/40"
    >
      <div className="relative aspect-[4/3] w-full bg-[#0d0d0d]">
        {image ? (
          <Image
            src={image}
            alt=""
            aria-hidden="true"
            fill
            unoptimized
            sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-contain p-4 transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-700">
            <IconImage className="h-10 w-10" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        {categoryLabel && (
          <span className="w-fit rounded-full border border-gray-800 bg-[#0d0d0d] px-2.5 py-0.5 text-xs font-medium text-gray-400">
            {categoryLabel}
          </span>
        )}
        <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-white">
          <bdi>{product.name}</bdi>
        </h3>
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs font-bold text-teal-300"
          >
            {initial}
          </span>
          <span className="truncate">{byShopLabel}</span>
        </p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <span className="text-lg font-bold text-teal-400">
            <bdi>{formatPrice(product.price, product.currency, locale)}</bdi>
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white transition-colors group-hover:text-teal-300">
            {viewLabel}
            <IconArrow className="h-4 w-4 rtl:-scale-x-100" />
          </span>
        </div>
      </div>
    </Link>
  );
}
