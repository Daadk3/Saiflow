-- Schema objects that schema.prisma has had since before migrations tracked
-- them.
--
-- These columns and indexes are in schema.prisma, and the Production database
-- serves queries that need the columns, but no earlier migration creates
-- them. A database built from migrations alone (a fresh Preview database, a
-- restore, a new environment) therefore lacked them: every query that reads a
-- User failed there, sign-up included, and so did every Product query.
--
-- Found by comparing, as text, the output of `prisma migrate diff
-- --from-empty --to-schema-datamodel` (offline, no database) with every
-- earlier migration. That comparison found no other difference in tables,
-- columns (type, nullability, default), indexes, enum values or foreign keys.
--
-- Every statement is IF NOT EXISTS, so this is a no-op wherever an object
-- already exists, and adds it everywhere else. The new columns are nullable
-- and start empty. No existing row is changed.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "category" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_resetToken_key" ON "User"("resetToken");
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX IF NOT EXISTS "Shop_isActive_idx" ON "Shop"("isActive");
CREATE INDEX IF NOT EXISTS "Shop_createdAt_idx" ON "Shop"("createdAt");
CREATE INDEX IF NOT EXISTS "Product_slug_idx" ON "Product"("slug");
CREATE INDEX IF NOT EXISTS "Product_isActive_idx" ON "Product"("isActive");
CREATE INDEX IF NOT EXISTS "Product_category_idx" ON "Product"("category");
CREATE INDEX IF NOT EXISTS "Product_createdAt_idx" ON "Product"("createdAt");
