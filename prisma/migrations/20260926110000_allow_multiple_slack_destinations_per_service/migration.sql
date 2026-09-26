-- CreateTable
CREATE TABLE IF NOT EXISTS "SlackDestination" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "integrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "SlackDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SlackDestination_serviceId_workspaceId_channelId_key" ON "SlackDestination"("serviceId", "workspaceId", "channelId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackDestination_serviceId_idx" ON "SlackDestination"("serviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackDestination_serviceId_enabled_idx" ON "SlackDestination"("serviceId", "enabled");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackDestination_workspaceId_idx" ON "SlackDestination"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackDestination_channelId_idx" ON "SlackDestination"("channelId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackDestination_integrationId_idx" ON "SlackDestination"("integrationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlackDestination_enabled_idx" ON "SlackDestination"("enabled");

-- AddForeignKey
ALTER TABLE "SlackDestination" DROP CONSTRAINT IF EXISTS "SlackDestination_serviceId_fkey";
ALTER TABLE "SlackDestination" ADD CONSTRAINT "SlackDestination_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackDestination" DROP CONSTRAINT IF EXISTS "SlackDestination_integrationId_fkey";
ALTER TABLE "SlackDestination" ADD CONSTRAINT "SlackDestination_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SlackIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackDestination" DROP CONSTRAINT IF EXISTS "SlackDestination_updatedBy_fkey";
ALTER TABLE "SlackDestination" ADD CONSTRAINT "SlackDestination_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing single service.slackChannel entries into SlackDestination
INSERT INTO "SlackDestination" ("id", "serviceId", "workspaceId", "channelId", "channelName", "enabled", "integrationId", "createdAt", "updatedAt")
SELECT
    'slack_dest_' || SUBSTRING(MD5(s."id" || '_' || s."slackChannel"), 1, 20),
    s."id",
    COALESCE(s."slackWorkspaceId", si."workspaceId", 'default_workspace'),
    s."slackChannel",
    s."slackChannel",
    true,
    s."slackIntegrationId",
    NOW(),
    NOW()
FROM "Service" s
LEFT JOIN "SlackIntegration" si ON (s."slackIntegrationId" = si."id" OR (si."enabled" = true AND si."workspaceId" IS NOT NULL))
WHERE s."slackChannel" IS NOT NULL
  AND TRIM(s."slackChannel") <> ''
ON CONFLICT ("serviceId", "workspaceId", "channelId") DO NOTHING;
