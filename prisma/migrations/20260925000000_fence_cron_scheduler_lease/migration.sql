ALTER TABLE "cron_scheduler_state"
ADD COLUMN "leaseEpoch" INTEGER NOT NULL DEFAULT 0;
