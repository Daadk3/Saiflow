-- When a new account accepted the Terms and Privacy Policy, and which
-- version. Both columns are nullable: accounts created before this change
-- stay valid and can still sign in with NULL.
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "termsVersion" TEXT;
