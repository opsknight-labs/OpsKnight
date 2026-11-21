-- Additive only: one new enum and one new, empty table for Squire's read-only observability connectors.
-- Nothing existing is altered. The table holds a handful of administrator-configured rows, so it needs no
-- index beyond its primary key and the unique name.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

CREATE TYPE "ObservabilityConnectionKind" AS ENUM (
  'PROMETHEUS',
  'LOKI',
  'TEMPO',
  'GRAFANA',
  'DATADOG',
  'ELASTIC',
  'CLOUDWATCH',
  'SENTRY',
  'GITHUB',
  'GITLAB'
);

CREATE TABLE "ObservabilityConnection" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "ObservabilityConnectionKind" NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "credentialEncrypted" TEXT,
  "region" TEXT,
  "org" TEXT,
  "project" TEXT,
  "allowedTeamIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "allowPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ObservabilityConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ObservabilityConnection_timeout_check" CHECK ("timeoutMs" BETWEEN 1000 AND 30000)
);
CREATE UNIQUE INDEX "ObservabilityConnection_name_key" ON "ObservabilityConnection"("name");

RESET statement_timeout;
RESET lock_timeout;
