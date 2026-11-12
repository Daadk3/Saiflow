-- Verified-buyer product reviews.
--
-- Timestamp 20261112130000, after 20261112120000_product_landing_and_compare_at.
-- Prisma applies folders in lexicographic order, so this cannot tie with that
-- migration or run before it.
--
-- Additive. Creates ProductReview and ProductReviewReport only.
-- The legacy Rating table is untouched. No rows are inserted, updated
-- or backfilled: a product with no reviews shows nothing.
-- Guarded so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS "ProductReview" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "body" VARCHAR(500),
    "hiddenAt" TIMESTAMP(3),
    "hiddenBy" TEXT,
    "hiddenReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductReview_orderId_productId_key" ON "ProductReview"("orderId", "productId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductReview_buyerEmail_productId_key" ON "ProductReview"("buyerEmail", "productId");
CREATE INDEX IF NOT EXISTS "ProductReview_productId_hiddenAt_createdAt_idx" ON "ProductReview"("productId", "hiddenAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductReview_hiddenAt_idx" ON "ProductReview"("hiddenAt");

DO $$ BEGIN
  ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_stars_range" CHECK ("stars" >= 1 AND "stars" <= 5);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ProductReviewReport" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReviewReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductReviewReport_reviewId_reporterUserId_key" ON "ProductReviewReport"("reviewId", "reporterUserId");
CREATE INDEX IF NOT EXISTS "ProductReviewReport_createdAt_idx" ON "ProductReviewReport"("createdAt");

DO $$ BEGIN
  ALTER TABLE "ProductReviewReport" ADD CONSTRAINT "ProductReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
