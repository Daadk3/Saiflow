-- Where a store is based, so the founder can see it before launch.
--
-- Additive only: two nullable columns and an index. Existing shops stay
-- NULL and the admin directory shows them as unknown. No row is rewritten,
-- no column is dropped, and nothing in payments or file safety is touched.
-- IF NOT EXISTS keeps this a no-op wherever the columns already exist.

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "country" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "city" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Shop_country_idx" ON "Shop"("country");
