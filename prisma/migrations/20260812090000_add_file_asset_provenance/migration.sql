-- Upload provenance.
--
-- Purely additive: one new enum, one new table, no change to any existing
-- table or row. Nothing is backfilled — legacy deliverables have no provenance
-- record, which is correct, because no legacy upload was ever observed by this
-- pipeline. They stay unattributable and unscanned until the Stage E backfill.
--
-- FileAsset.key is the UploadThing object key and the primary key, so a given
-- object can be recorded exactly once.

-- CreateEnum
CREATE TYPE "UploadRoute" AS ENUM ('PRODUCT_FILE', 'PRODUCT_THUMBNAIL', 'SHOP_LOGO', 'SHOP_COVER');

-- AlterEnum
-- Additive: existing ModerationEvent rows are unaffected, and every consumer
-- filters on specific action values rather than switching exhaustively.
ALTER TYPE "ModerationAction" ADD VALUE 'SCANNED';

-- CreateTable
CREATE TABLE "FileAsset" (
    "key" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "route" "UploadRoute" NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "declaredType" TEXT NOT NULL,
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING_SCAN',
    "scanSha256" TEXT,
    "scanAt" TIMESTAMP(3),
    "scanAttempts" INTEGER NOT NULL DEFAULT 0,
    "scanReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "FileAsset_shopId_idx" ON "FileAsset"("shopId");

-- CreateIndex
CREATE INDEX "FileAsset_scanStatus_idx" ON "FileAsset"("scanStatus");

-- CreateIndex
CREATE INDEX "FileAsset_route_idx" ON "FileAsset"("route");

-- CreateIndex
CREATE INDEX "FileAsset_createdAt_idx" ON "FileAsset"("createdAt");

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
