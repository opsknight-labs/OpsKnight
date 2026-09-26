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
    'slack_dest_' || SUBSTRING(MD5(s."id" || '_' || TRIM(s."slackChannel")), 1, 20),
    s."id",
    COALESCE(
      s."slackWorkspaceId",
      si_direct."workspaceId",
      si_global."workspaceId",
      'default_workspace'
    ),
    TRIM(s."slackChannel"),
    TRIM(s."slackChannel"),
    true,
    COALESCE(s."slackIntegrationId", si_global."id"),
    NOW(),
    NOW()
FROM "Service" s
LEFT JOIN "SlackIntegration" si_direct ON s."slackIntegrationId" = si_direct."id"
LEFT JOIN LATERAL (
    SELECT "id", "workspaceId"
    FROM "SlackIntegration"
    WHERE "enabled" = true AND "workspaceId" IS NOT NULL
    ORDER BY "createdAt" ASC
    LIMIT 1
) si_global ON s."slackIntegrationId" IS NULL
WHERE s."slackChannel" IS NOT NULL
  AND TRIM(s."slackChannel") <> ''
ON CONFLICT DO NOTHING;
