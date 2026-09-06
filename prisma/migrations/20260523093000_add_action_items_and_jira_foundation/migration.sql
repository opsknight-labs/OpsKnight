-- Jira + ActionItem foundation migration.
--
-- Rolling-safe contract: every change here is additive. Old pods can keep
-- running against the migrated database during rollout, and rollback to the
-- previous application version remains viable because legacy Postmortem
-- JSON action items are untouched.
--
-- After this migration is applied:
--   - New code can begin dual-writing normalized ActionItem rows.
--   - Readers can start preferring ActionItem rows while falling back to
--     Postmortem.actionItems JSON for backfill compatibility.
--   - Jira config, service mapping, and external issue link tables exist
--     but are not yet required by the application.


-- ------------------------------------------------------------------
-- 1) New enums
-- ------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "ActionItemStatus" AS ENUM (
        'OPEN',
        'IN_PROGRESS',
        'COMPLETED',
        'BLOCKED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ActionItemPriority" AS ENUM (
        'HIGH',
        'MEDIUM',
        'LOW'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ActionItemSource" AS ENUM (
        'POSTMORTEM',
        'MANUAL'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ExternalIssueProvider" AS ENUM (
        'JIRA'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ExternalIssueSyncState" AS ENUM (
        'PENDING',
        'SYNCED',
        'FAILED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- ------------------------------------------------------------------
-- 2) Normalized ActionItem storage
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ActionItem" (
    "id"          TEXT                 NOT NULL,
    "postmortemId" TEXT                NOT NULL,
    "incidentId"  TEXT                 NOT NULL,
    "title"       TEXT                 NOT NULL,
    "description" TEXT,
    "ownerId"     TEXT,
    "dueDate"     TIMESTAMP(3),
    "status"      "ActionItemStatus"   NOT NULL DEFAULT 'OPEN',
    "priority"    "ActionItemPriority" NOT NULL DEFAULT 'MEDIUM',
    "source"      "ActionItemSource"   NOT NULL DEFAULT 'POSTMORTEM',
    "createdAt"   TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)         NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ActionItem_postmortemId_fkey"
      FOREIGN KEY ("postmortemId") REFERENCES "Postmortem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActionItem_incidentId_fkey"
      FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActionItem_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ActionItem_postmortemId_idx"
    ON "ActionItem" ("postmortemId");
CREATE INDEX IF NOT EXISTS "ActionItem_incidentId_status_idx"
    ON "ActionItem" ("incidentId", "status");
CREATE INDEX IF NOT EXISTS "ActionItem_ownerId_status_idx"
    ON "ActionItem" ("ownerId", "status");
CREATE INDEX IF NOT EXISTS "ActionItem_status_priority_idx"
    ON "ActionItem" ("status", "priority");
CREATE INDEX IF NOT EXISTS "ActionItem_dueDate_idx"
    ON "ActionItem" ("dueDate");


-- ------------------------------------------------------------------
-- 3) Jira workspace configuration and per-service mapping
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "JiraConfig" (
    "id"                     TEXT         NOT NULL,
    "baseUrl"                TEXT         NOT NULL,
    "userEmail"              TEXT         NOT NULL,
    "apiTokenEncrypted"      TEXT         NOT NULL,
    "enabled"                BOOLEAN      NOT NULL DEFAULT true,
    "defaultProjectKey"      TEXT,
    "webhookSecretEncrypted" TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,
    "updatedBy"              TEXT         NOT NULL,

    CONSTRAINT "JiraConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JiraConfig_updatedBy_fkey"
      FOREIGN KEY ("updatedBy") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "JiraServiceMapping" (
    "id"                      TEXT         NOT NULL,
    "serviceId"               TEXT         NOT NULL,
    "projectKey"              TEXT         NOT NULL,
    "incidentIssueType"       TEXT         NOT NULL,
    "actionItemIssueType"     TEXT         NOT NULL,
    "defaultLabels"           TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "defaultComponent"        TEXT,
    "autoCreateIncidentIssue" BOOLEAN      NOT NULL DEFAULT false,
    "syncEnabled"             BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraServiceMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JiraServiceMapping_serviceId_fkey"
      FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "JiraServiceMapping_serviceId_key"
    ON "JiraServiceMapping" ("serviceId");
CREATE INDEX IF NOT EXISTS "JiraServiceMapping_projectKey_idx"
    ON "JiraServiceMapping" ("projectKey");


-- ------------------------------------------------------------------
-- 4) Provider-agnostic external issue links
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExternalIssueLink" (
    "id"               TEXT                     NOT NULL,
    "provider"         "ExternalIssueProvider"  NOT NULL DEFAULT 'JIRA',
    "incidentId"       TEXT,
    "actionItemId"     TEXT,
    "externalId"       TEXT                     NOT NULL,
    "externalKey"      TEXT                     NOT NULL,
    "externalUrl"      TEXT                     NOT NULL,
    "externalStatus"   TEXT,
    "externalAssignee" TEXT,
    "syncState"        "ExternalIssueSyncState" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt"     TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)             NOT NULL,

    CONSTRAINT "ExternalIssueLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExternalIssueLink_incidentId_fkey"
      FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExternalIssueLink_actionItemId_fkey"
      FOREIGN KEY ("actionItemId") REFERENCES "ActionItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIssueLink_provider_externalId_key"
    ON "ExternalIssueLink" ("provider", "externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIssueLink_provider_externalKey_key"
    ON "ExternalIssueLink" ("provider", "externalKey");
CREATE INDEX IF NOT EXISTS "ExternalIssueLink_incidentId_idx"
    ON "ExternalIssueLink" ("incidentId");
CREATE INDEX IF NOT EXISTS "ExternalIssueLink_actionItemId_idx"
    ON "ExternalIssueLink" ("actionItemId");
CREATE INDEX IF NOT EXISTS "ExternalIssueLink_syncState_idx"
    ON "ExternalIssueLink" ("syncState");
CREATE INDEX IF NOT EXISTS "ExternalIssueLink_provider_syncState_idx"
    ON "ExternalIssueLink" ("provider", "syncState");
