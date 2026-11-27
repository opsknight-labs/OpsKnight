-- Slack channel nudges, Slack Connect war-room invites and Enterprise Grid installs. Additive only.
ALTER TABLE "ChatOpsConfig" ADD COLUMN "slackUnackedNudgeMinutes" INTEGER;
ALTER TABLE "ChatOpsConfig" ADD COLUMN "slackNoUpdateNudgeMinutes" INTEGER;
ALTER TABLE "ChatOpsConfig" ADD COLUMN "slackWarRoomExternalEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "SlackIntegration" ADD COLUMN "enterpriseId" TEXT;
CREATE INDEX "SlackIntegration_enterpriseId_idx" ON "SlackIntegration"("enterpriseId");
