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
-- Backfill: the founder's stores keep selling. Shop has no ownerId column.
-- The owner is the ShopUser row with role OWNER. Every shop owned by an
-- OWNER of daad-s-store is turned on, and these slugs are listed as well:
-- daad-s-store, novasphere-ai, dakhl-mutaghayyir, interview-ready-ksa,
-- mawlood-ready. Other stores stay at the default, false.
-- PostgreSQL runs a migration in one transaction, so those stores never
-- have a committed window where salesEnabled is false.
--
-- ShopSalesEvent is the append-only audit of later toggles, the same idea
-- as ModerationEvent. The backfill does not invent history rows.

ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "salesEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Shop"
SET "salesEnabled" = true
WHERE "slug" IN ('daad-s-store', 'novasphere-ai', 'dakhl-mutaghayyir', 'interview-ready-ksa', 'mawlood-ready')
OR "id" IN (
SELECT member."shopId"
FROM "ShopUser" member
WHERE member."role" = 'OWNER'
AND member."userId" IN (
SELECT founder."userId"
FROM "ShopUser" founder
INNER JOIN "Shop" founder_shop ON founder_shop."id" = founder."shopId"
WHERE founder_shop."slug" = 'daad-s-store'
AND founder."role" = 'OWNER'
)
);

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
