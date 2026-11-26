-- B2: Teams client secret expiry tracking and last inbound activity (additive, nullable).
ALTER TABLE "MicrosoftTeamsConfig" ADD COLUMN IF NOT EXISTS "clientSecretExpiresAt" TIMESTAMP(3);
ALTER TABLE "MicrosoftTeamsInstallation" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3);
