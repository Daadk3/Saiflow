-- Founder test payments (lib/payments/live-mode).
--
-- A founder may make a small real payment on the production Geidea account
-- while checkout is otherwise closed. Its attempt and its Order are marked
-- here so they are never counted as revenue and never paid out to a seller.
--
-- Additive only: two NOT NULL booleans defaulting to false, so every
-- existing row reads as an ordinary payment and no row is otherwise changed.
-- IF NOT EXISTS keeps it a no-op wherever the columns already exist.

-- AlterTable
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "founderTest" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "founderTest" BOOLEAN NOT NULL DEFAULT false;
