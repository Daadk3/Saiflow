-- Trust & Safety Tier 0: moderation status, seller certification, audit log

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'RESUBMITTED', 'REPORTED');

-- AlterTable: new uploads default to PENDING
ALTER TABLE "Product"
  ADD COLUMN "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "certifiedAt" TIMESTAMP(3);

-- Backfill: products that existed before moderation was introduced remain
-- publicly visible (they were already live). Only NEW uploads start PENDING.
UPDATE "Product" SET "moderationStatus" = 'APPROVED';

-- CreateTable
CREATE TABLE "ModerationEvent" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "previousStatus" "ModerationStatus",
    "newStatus" "ModerationStatus",
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_moderationStatus_idx" ON "Product"("moderationStatus");
CREATE INDEX "ModerationEvent_productId_idx" ON "ModerationEvent"("productId");
CREATE INDEX "ModerationEvent_action_idx" ON "ModerationEvent"("action");
CREATE INDEX "ModerationEvent_createdAt_idx" ON "ModerationEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
