-- Extra private deliverables on a product.
--
-- Additive. Existing products have no rows, so they keep selling and
-- downloading the single file on Product.fileKey. No row is rewritten.
-- Guarded so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS "ProductDeliverable" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileScanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING_SCAN',
    "fileScanKey" TEXT,
    "fileScanSha256" TEXT,
    "fileScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDeliverable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductDeliverable_productId_position_key" ON "ProductDeliverable"("productId", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductDeliverable_productId_fileKey_key" ON "ProductDeliverable"("productId", "fileKey");
CREATE INDEX IF NOT EXISTS "ProductDeliverable_fileKey_idx" ON "ProductDeliverable"("fileKey");

DO $$ BEGIN
  ALTER TABLE "ProductDeliverable" ADD CONSTRAINT "ProductDeliverable_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
