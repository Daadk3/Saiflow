/**
 * The refusal sent when a product is saved without its deliverable file.
 *
 * Sellers were submitting products with only a cover or preview picture and
 * no file to sell, which the founder then had to reject by hand. The product
 * routes now refuse to create or save a product that has no deliverable;
 * the forms say so before the click, but the routes are the gate. The cover
 * picture is a separate field and never counts as the product file.
 */
export const FILE_REQUIRED = {
  // The forms show `error` as written, like every other refusal from these routes.
  error: "Upload your product file before submitting. The cover picture is not the product file.",
  code: "file_required",
} as const;
