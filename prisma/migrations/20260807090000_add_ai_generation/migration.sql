-- AI Listing Assistant v1: generation audit + durable usage accounting.
-- Purely additive: one new enum and one new table. No existing table, column,
-- constraint or row is touched, so this is safe to apply to a live database
-- and safe to roll back at the application layer.

-- CreateEnum
CREATE TYPE "AiGenerationStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "AiGenerationStatus" NOT NULL,
    "section" TEXT,
    "inputHash" TEXT NOT NULL,
    "output" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "fieldEvents" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGeneration_userId_createdAt_idx" ON "AiGeneration"("userId", "createdAt");
CREATE INDEX "AiGeneration_shopId_idx" ON "AiGeneration"("shopId");
CREATE INDEX "AiGeneration_status_idx" ON "AiGeneration"("status");
