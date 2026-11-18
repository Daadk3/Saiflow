-- The buyer's name, collected on SaiFlow's checkout page.
--
-- PaymentSession.buyerName is what the guest typed before paying.
-- Order.customerName is that name copied across when the Geidea callback
-- writes the purchase. Both are nullable: every attempt and order from
-- before this column has no name, and those rows must keep working.
-- Nothing here backfills a name, and nothing here changes a paid amount,
-- a payout, or an existing email.
--
-- IF NOT EXISTS keeps this a no-op on a database that already has the columns.

-- AlterTable
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "buyerName" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
