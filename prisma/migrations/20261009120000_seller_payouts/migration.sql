-- Manual seller payouts: where a shop is paid, and what was paid.
--
-- 1. SellerPayoutAccount: one per shop, entered by the shop's owner. A new
--    table; no existing row is touched.
-- 2. Payout: one bank transfer made by SaiFlow's admin, recorded afterwards.
--    A new table.
-- 3. Order gains a nullable payoutId. Every existing order keeps NULL, which
--    means "not paid out yet", and every value it had. The foreign key is
--    ON DELETE RESTRICT: a recorded payout cannot be deleted from under the
--    orders it paid for.
--
-- Generated with `prisma migrate diff` from the previous schema file to this
-- one, offline. Nothing here was executed against any database.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "payoutId" TEXT;

-- CreateTable
CREATE TABLE "SellerPayoutAccount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "bankName" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerPayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "orderCount" INTEGER NOT NULL,
    "bankReference" TEXT NOT NULL,
    "ibanLast4" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellerPayoutAccount_shopId_key" ON "SellerPayoutAccount"("shopId");

-- CreateIndex
CREATE INDEX "Payout_shopId_idx" ON "Payout"("shopId");

-- CreateIndex
CREATE INDEX "Payout_paidAt_idx" ON "Payout"("paidAt");

-- CreateIndex
CREATE INDEX "Order_payoutId_idx" ON "Order"("payoutId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerPayoutAccount" ADD CONSTRAINT "SellerPayoutAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

