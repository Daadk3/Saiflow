-- Agent launch list for /agents "Notify me". Creates one new, empty table.
-- No existing table, column or row is changed, and no rows are rewritten.
CREATE TABLE "AgentWaitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentWaitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentWaitlist_email_agentSlug_key" ON "AgentWaitlist"("email", "agentSlug");

CREATE INDEX "AgentWaitlist_createdAt_idx" ON "AgentWaitlist"("createdAt");
