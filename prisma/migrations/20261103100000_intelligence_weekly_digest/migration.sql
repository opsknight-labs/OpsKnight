-- OpsKnight Intelligence: scheduled weekly digest email. Off by default. Additive.
BEGIN;

CREATE TABLE "IntelligenceDigestSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "hourUtc" INTEGER NOT NULL DEFAULT 8,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelligenceDigestSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntelligenceDigestSettings_singleton_check" CHECK ("id" = 'default'),
    CONSTRAINT "IntelligenceDigestSettings_day_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
    CONSTRAINT "IntelligenceDigestSettings_hour_check" CHECK ("hourUtc" BETWEEN 0 AND 23)
);

CREATE TABLE "IntelligenceDigestRun" (
    "weekKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sentTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IntelligenceDigestRun_pkey" PRIMARY KEY ("weekKey"),
    CONSTRAINT "IntelligenceDigestRun_week_check" CHECK ("weekKey" ~ '^[0-9]{4}-W[0-9]{2}$'),
    CONSTRAINT "IntelligenceDigestRun_status_check" CHECK ("status" IN ('SENDING', 'COMPLETED'))
);

CREATE INDEX "idx_intelligence_digest_run_started" ON "IntelligenceDigestRun"("startedAt");

COMMIT;
