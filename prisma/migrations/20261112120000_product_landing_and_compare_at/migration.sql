-- Optional long-form product page and an optional compare-at price.
--
-- Additive. Both columns are nullable and have no default. Existing products
-- stay NULL: the public page renders exactly as before, and checkout keeps
-- charging Product.price. No row is rewritten.
-- IF NOT EXISTS keeps this a no-op wherever the columns already exist.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "compareAtPrice" DECIMAL(10,2);

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "landing" JSONB;
