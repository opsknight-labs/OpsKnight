BEGIN;

-- Each person's share of the daily AI token budget, so one heavy user cannot spend it for everyone.
ALTER TABLE "AiSettings" ADD COLUMN "userDailyTokenBudget" INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_userDailyTokenBudget_check"
  CHECK ("userDailyTokenBudget" BETWEEN 1000 AND 1000000000);

CREATE TABLE "AiUsageUserDay" (
    "day" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiUsageUserDay_pkey" PRIMARY KEY ("day", "userId")
);
CREATE INDEX "idx_ai_usage_user_day_retention" ON "AiUsageUserDay"("day");
ALTER TABLE "AiUsageUserDay" ADD CONSTRAINT "AiUsageUserDay_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Single-use receipts for assistant actions a person confirmed.
CREATE TABLE "SquireActionReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SquireActionReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_squire_action_receipt_retention" ON "SquireActionReceipt"("createdAt");
ALTER TABLE "SquireActionReceipt" ADD CONSTRAINT "SquireActionReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
