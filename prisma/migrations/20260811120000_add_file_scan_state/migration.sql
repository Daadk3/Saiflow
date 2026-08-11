-- File-safety foundation.
--
-- Purely additive. Every existing row lands on fileScanStatus = 'PENDING_SCAN'
-- with fileKey = NULL, which is the correct starting point: no legacy file has
-- ever been scanned, and nothing here infers or backfills a verdict.
--
-- The safety predicate used from Stage C onwards is
--   fileScanStatus = 'SAFE' AND fileScanKey = fileKey AND fileKey IS NOT NULL
-- so legacy rows are non-safe on two independent counts.

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING_SCAN', 'SAFE', 'UNSAFE', 'SCAN_ERROR');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "fileKey" TEXT,
ADD COLUMN     "fileScanAt" TIMESTAMP(3),
ADD COLUMN     "fileScanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fileScanKey" TEXT,
ADD COLUMN     "fileScanSha256" TEXT,
ADD COLUMN     "fileScanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING_SCAN';

-- CreateIndex
CREATE INDEX "Product_fileScanStatus_idx" ON "Product"("fileScanStatus");
