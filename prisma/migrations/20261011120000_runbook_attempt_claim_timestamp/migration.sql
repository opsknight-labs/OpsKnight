ALTER TABLE "RunbookStepAttempt" ADD COLUMN "claimedAt" TIMESTAMP(3);
-- Existing attempts intentionally remain NULL: their exact claim time was not recorded.
