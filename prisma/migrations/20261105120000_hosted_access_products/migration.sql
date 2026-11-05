-- Hosted-access products (e.g. access to an AI agent the seller hosts).
--
-- Additive only. One enum, one column with a default, one new table. Every
-- existing product becomes deliveryType = FILE, which is exactly what it is
-- today, so no existing row changes meaning and no file gate changes.
-- No row is rewritten, nothing is dropped, and nothing in payments reads the
-- new table. Guarded so a re-run is a no-op.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProductDeliveryType" AS ENUM ('FILE', 'HOSTED_ACCESS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "deliveryType" "ProductDeliveryType" NOT NULL DEFAULT 'FILE';

-- CreateTable
CREATE TABLE IF NOT EXISTS "HostedAccess" (
    "productId" TEXT NOT NULL,
    "accessUrl" TEXT NOT NULL,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostedAccess_pkey" PRIMARY KEY ("productId")
);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "HostedAccess" ADD CONSTRAINT "HostedAccess_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
