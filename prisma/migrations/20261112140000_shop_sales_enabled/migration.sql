-- Per-store sales switch.
--
-- Timestamp 20261112140000, after 20261112130000_product_reviews.
-- Prisma applies folders in lexicographic order, so this cannot tie with
-- that migration or run before it.
--
-- Additive only. Shop.salesEnabled defaults to false, so a store does not
-- sell until the founder turns sales on. Nothing here approves a product,
-- and no column is dropped or rewritten.
--
-- Backfill: the two founder stores keep selling. Admin addresses live in
-- process configuration, not in a table, so they cannot be applied in SQL
-- without copying them into this file. Only the known slugs are updated.
-- PostgreSQL runs a migration in one transaction, so those stores never
-- have a committed window where salesEnabled is false.
--
-- ShopSalesEvent is the append-only audit of later toggles, the same idea
-- as ModerationEvent. The backfill does not invent history rows.

ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "salesEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Shop"
SET "salesEnabled" = true
WHERE "slug" IN ('daad-s-store', 'novasphere-ai');

CREATE INDEX IF NOT EXISTS "Shop_salesEnabled_idx" ON "Shop"("salesEnabled");

CREATE TABLE IF NOT EXISTS "ShopSalesEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSalesEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShopSalesEvent_shopId_idx" ON "ShopSalesEvent"("shopId");
CREATE INDEX IF NOT EXISTS "ShopSalesEvent_createdAt_idx" ON "ShopSalesEvent"("createdAt");

DO $$ BEGIN
  ALTER TABLE "ShopSalesEvent" ADD CONSTRAINT "ShopSalesEvent_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
