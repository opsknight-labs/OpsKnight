-- OpsKnight Intelligence: AI gateway settings, providers and usage accounting. Purely additive.
-- Disabled by default; the singleton row is created only when an administrator saves settings.
BEGIN;

CREATE TYPE "AiProviderKind" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENAI_COMPATIBLE');

CREATE TYPE "AiDataClass" AS ENUM ('PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE');

CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "squireEnabled" BOOLEAN NOT NULL DEFAULT false,
    "squireName" TEXT NOT NULL DEFAULT 'Squire',
    "allowExternalFallback" BOOLEAN NOT NULL DEFAULT false,
    "requestsPerMinutePerUser" INTEGER NOT NULL DEFAULT 20,
    "dailyTokenBudget" INTEGER NOT NULL DEFAULT 500000,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 1024,
    "requestTimeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiSettings_singleton_check" CHECK ("id" = 'default'),
    CONSTRAINT "AiSettings_name_check" CHECK (char_length("squireName") BETWEEN 1 AND 32),
    CONSTRAINT "AiSettings_rate_check" CHECK ("requestsPerMinutePerUser" BETWEEN 1 AND 600),
    CONSTRAINT "AiSettings_budget_check" CHECK ("dailyTokenBudget" BETWEEN 1000 AND 1000000000),
    CONSTRAINT "AiSettings_output_check" CHECK ("maxOutputTokens" BETWEEN 64 AND 8192),
    CONSTRAINT "AiSettings_timeout_check" CHECK ("requestTimeoutMs" BETWEEN 1000 AND 120000)
);

CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEncrypted" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isExternal" BOOLEAN NOT NULL DEFAULT true,
    "maxDataClass" "AiDataClass" NOT NULL DEFAULT 'INTERNAL',
    "allowPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiProvider_name_check" CHECK (char_length("name") BETWEEN 1 AND 64),
    CONSTRAINT "AiProvider_model_check" CHECK (char_length("model") BETWEEN 1 AND 128),
    CONSTRAINT "AiProvider_priority_check" CHECK ("priority" BETWEEN 0 AND 10000)
);

CREATE TABLE "AiUsageDay" (
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("day")
);

CREATE UNIQUE INDEX "AiProvider_name_key" ON "AiProvider"("name");

CREATE INDEX "AiProvider_enabled_priority_idx" ON "AiProvider"("enabled", "priority");

COMMIT;
