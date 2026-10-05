"use client";

import Image from "next/image";
import { useState } from "react";
import type { ReactNode } from "react";

interface ProductThumbnailProps {
  /** The stored thumbnail URL, or null when the product has none. */
  src: string | null;
  /** Rendered instead of the image when there is no usable thumbnail. */
  fallback: ReactNode;
  sizes: string;
}

/**
 * A product thumbnail that never shows a blank frame or a broken-image icon:
 * no URL, or a URL that fails to load, both render the caller's fallback.
 * Real artwork is never cropped: it is contained and centred in the frame,
 * and a subtle tinted backdrop fills whatever the artwork does not cover, so
 * portrait ebook and course covers keep every word and edge.
 * This is the only client-side piece of the product card.
 */
export function ProductThumbnail({ src, fallback, sizes }: ProductThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <>{fallback}</>;

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-gray-800/50 via-[#0d0d0d] to-[#0d0d0d]">
      <Image
        src={src}
        alt=""
        aria-hidden="true"
        fill
        unoptimized
        sizes={sizes}
        onError={() => setFailed(true)}
        className="object-contain object-center p-3 transition duration-300 group-hover:scale-[1.02]"
      />
    </div>
  );
}
