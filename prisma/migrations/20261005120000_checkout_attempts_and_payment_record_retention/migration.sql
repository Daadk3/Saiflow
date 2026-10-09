-- Checkout attempts that resume instead of multiplying, and payment records
-- that outlive their product.
--
-- 1. PaymentSession gains three nullable columns: clientTokenHash,
--    currentAttemptKey (unique) and presentation. Every existing row keeps
--    NULL in all three and every value it had. Such a row is never resumed
--    and never blocks a new attempt; the unique index admits any number of
--    NULLs, so it cannot conflict with existing rows.
--
-- 2. Order.productId and PaymentSession.productId stop cascading from
--    Product: ON DELETE CASCADE becomes ON DELETE RESTRICT. No row is
--    changed. Each constraint is dropped and re-created, inside this
--    migration's transaction, and re-validated against rows that already
--    satisfy it because the cascade kept them consistent. From then on the
--    database refuses to delete a product that any Order or PaymentSession
--    names. A product with neither still deletes as before, and its ratings
--    and moderation events still go with it.
--
-- Generated with `prisma migrate diff` from the previous schema file to this
-- one, offline. Nothing here was executed against any database.

-- CreateEnum
CREATE TYPE "CheckoutPresentation" AS ENUM ('REDIRECT', 'DROPIN');

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_productId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentSession" DROP CONSTRAINT "PaymentSession_productId_fkey";

-- AlterTable
ALTER TABLE "PaymentSession" ADD COLUMN     "clientTokenHash" TEXT,
ADD COLUMN     "currentAttemptKey" TEXT,
ADD COLUMN     "presentation" "CheckoutPresentation";

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSession_currentAttemptKey_key" ON "PaymentSession"("currentAttemptKey");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
