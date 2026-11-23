-- PayPal as a second payment provider. Additive only: one enum value and
-- three nullable columns. No existing row is rewritten; Geidea attempts keep
-- NULL in the new columns.
ALTER TYPE "PaymentProvider" ADD VALUE 'PAYPAL';

ALTER TABLE "PaymentSession" ADD COLUMN "chargeAmount" DECIMAL(10,2);
ALTER TABLE "PaymentSession" ADD COLUMN "chargeCurrency" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN "chargeRate" DECIMAL(10,4);
