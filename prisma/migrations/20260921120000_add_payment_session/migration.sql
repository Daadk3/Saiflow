-- Geidea payment attempts.
--
-- Purely additive. No row is deleted, rewritten or backfilled: the new
-- NOT NULL columns on "Order" carry defaults that describe every existing row
-- truthfully (STRIPE, TEST, SAR), and "stripeSessionId" only loses NOT NULL so
-- that a Geidea order, which has no Stripe session, can exist at all. Its
-- unique index stays, so the dormant Stripe webhook still matches on it.
--
-- "PaymentSession" is a payment ATTEMPT, not a purchase. Nothing may treat a
-- row here as proof of payment. That remains "Order" alone, and an Order is
-- written only from a verified provider confirmation.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'GEIDEA');

-- CreateEnum
CREATE TYPE "PaymentEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "PaymentSessionStatus" AS ENUM ('CREATED', 'SESSION_CREATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- AlterTable
-- Every added NOT NULL column has a default, so this succeeds on a populated
-- table and existing rows need no UPDATE.
ALTER TABLE "Order" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'SAR',
ADD COLUMN     "merchantReferenceId" TEXT,
ADD COLUMN     "paymentEnvironment" "PaymentEnvironment" NOT NULL DEFAULT 'TEST',
ADD COLUMN     "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "providerOrderId" TEXT,
ALTER COLUMN "stripeSessionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PaymentSession" (
    "id" TEXT NOT NULL,
    "merchantReferenceId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerSessionId" TEXT,
    "providerOrderId" TEXT,
    "productId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "environment" "PaymentEnvironment" NOT NULL,
    "status" "PaymentSessionStatus" NOT NULL DEFAULT 'CREATED',
    "buyerEmail" TEXT,
    "providerStatus" TEXT,
    "failureReason" TEXT,
    "callbackReceivedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSession_merchantReferenceId_key" ON "PaymentSession"("merchantReferenceId");

-- CreateIndex
CREATE INDEX "PaymentSession_productId_idx" ON "PaymentSession"("productId");

-- CreateIndex
CREATE INDEX "PaymentSession_status_idx" ON "PaymentSession"("status");

-- CreateIndex
CREATE INDEX "PaymentSession_createdAt_idx" ON "PaymentSession"("createdAt");

-- CreateIndex
-- Postgres treats NULLs as distinct in a unique index, so attempts that have
-- no provider session or order yet do not collide with one another.
CREATE UNIQUE INDEX "PaymentSession_provider_providerSessionId_key" ON "PaymentSession"("provider", "providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSession_provider_providerOrderId_key" ON "PaymentSession"("provider", "providerOrderId");

-- CreateIndex
-- Idempotent fulfilment: one attempt yields at most one Order, and one
-- provider order id yields at most one Order. Existing Stripe rows hold NULL
-- in both columns and never collide.
CREATE UNIQUE INDEX "Order_merchantReferenceId_key" ON "Order"("merchantReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentProvider_providerOrderId_key" ON "Order"("paymentProvider", "providerOrderId");

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL, never CASCADE: removing an attempt row must never remove a purchase.
ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantReferenceId_fkey" FOREIGN KEY ("merchantReferenceId") REFERENCES "PaymentSession"("merchantReferenceId") ON DELETE SET NULL ON UPDATE CASCADE;
