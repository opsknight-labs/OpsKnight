-- CreateTable
CREATE TABLE "cron_scheduler_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lastRollupDate" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_scheduler_state_pkey" PRIMARY KEY ("id")
);
