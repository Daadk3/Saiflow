-- Seller early-access list. Created empty. No existing rows are rewritten.
CREATE TABLE "SellerWaitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "source" TEXT NOT NULL DEFAULT 'homepage',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerWaitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerWaitlist_email_key" ON "SellerWaitlist"("email");

CREATE INDEX "SellerWaitlist_createdAt_idx" ON "SellerWaitlist"("createdAt");
