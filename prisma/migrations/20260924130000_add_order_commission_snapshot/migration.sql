-- Commission snapshot on fulfilled Orders (lib/pricing).
--
-- Purely additive and nullable. No row is rewritten or backfilled: every
-- Order that exists today was fulfilled before the commission existed, so it
-- carries no split and is never reinterpreted. A new write path sets all five
-- columns together, and grossAmount = platformFeeAmount + sellerNetAmount
-- holds exactly, in halalas, by construction.
ALTER TABLE "Order"
  ADD COLUMN "grossAmount" DECIMAL(10,2),
  ADD COLUMN "platformFeeAmount" DECIMAL(10,2),
  ADD COLUMN "sellerNetAmount" DECIMAL(10,2),
  ADD COLUMN "commissionRateBps" INTEGER,
  ADD COLUMN "commissionVersion" TEXT;
