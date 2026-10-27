-- The founder's product review checklist.
--
-- Additive only: three nullable columns. Existing products stay NULL and
-- their checklist shows the auto points as "not checked yet" until the
-- seller next saves or the file is next scanned. No row is rewritten, no
-- column is dropped, and nothing in payments or the safety gates reads them.
-- IF NOT EXISTS keeps this a no-op wherever the columns already exist.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reviewChecks" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reviewChecksAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN IF NOT EXISTS "contentFacts" JSONB;
