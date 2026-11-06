import Image from "next/image";
import { PRODUCT_COVER } from "@/lib/product-cover";

/**
 * Product-detail cover. Width follows the column. Height follows the file,
 * so the picture is not cropped, stretched, or letterboxed.
 */
export function ProductCoverImage({
  src,
  alt,
  priority = false,
  unoptimized = false,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  unoptimized?: boolean;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={PRODUCT_COVER.width}
      height={PRODUCT_COVER.height}
      sizes="(min-width: 1024px) 720px, 100vw"
      priority={priority}
      unoptimized={unoptimized}
      className="h-auto w-full"
      style={{ width: "100%", height: "auto" }}
    />
  );
}
