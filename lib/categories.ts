/**
 * The single source of truth for the product taxonomy.
 *
 * These six values were previously duplicated across the add-product form,
 * the edit form and the browse filters, with `Product.category` stored as an
 * unconstrained string. That meant a bad client — or an AI suggestion — could
 * write a category that no filter renders, leaving a product live but
 * unfindable. Every producer and consumer now reads this list, and the server
 * rejects anything outside it.
 *
 * Do not add categories here without a product decision: the browse filters,
 * the translations and the AI prompt all derive from this list.
 */
export const PRODUCT_CATEGORIES = [
  "ebooks",
  "courses",
  "templates",
  "music",
  "art",
  "software",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** i18n keys for each category label, so no caller hardcodes strings. */
export const CATEGORY_LABEL_KEYS: Record<ProductCategory, string> = {
  ebooks: "categories.ebooksGuides",
  courses: "categories.onlineCourses",
  templates: "categories.templatesThemes",
  music: "categories.musicAudio",
  art: "categories.artGraphics",
  software: "categories.softwareApps",
};

/** Narrowing guard used by the API, the browse filters and AI output validation. */
export function isProductCategory(value: unknown): value is ProductCategory {
  return (
    typeof value === "string" &&
    (PRODUCT_CATEGORIES as readonly string[]).includes(value)
  );
}
