/**
 * Recommended product cover.
 *
 * The product page does not crop or stretch. It sizes the image to the
 * column width and lets the file's own ratio set the height, on phones and
 * on desktops. A square stays square. A wide image stays wide. There is no
 * letterbox frame and no center crop.
 *
 * 1920×1080 is 16:9, the shape sellers are asked to upload (the same shape
 * Gumroad uses for a product cover). The width and height are also the
 * pre-load hint on the image element. Help text must quote these numbers.
 */
export const PRODUCT_COVER = {
  width: 1920,
  height: 1080,
  /** Recommended upload ratio. The page does not force this onto other files. */
  ratioLabel: "16:9",
} as const;
