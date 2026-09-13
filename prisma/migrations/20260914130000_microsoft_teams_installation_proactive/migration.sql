-- Microsoft Teams proactive Bot transport fields for Graph PATCH fallback
-- Graph app-only PATCH restricts normal message updates to policyViolation;
-- canonical updates require Bot Framework updateActivity via serviceUrl+conversationId.
ALTER TABLE "MicrosoftTeamsInstallation" ADD COLUMN IF NOT EXISTS "serviceUrl" TEXT;
ALTER TABLE "MicrosoftTeamsInstallation" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "MicrosoftTeamsInstallation" ADD COLUMN IF NOT EXISTS "botRecipientId" TEXT;
