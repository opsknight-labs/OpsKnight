-- AlterTable: store the Slack app signing secret alongside the other app-level
-- credentials. Slack never returns it from OAuth, so it is admin-entered and
-- encrypted exactly like clientSecret.
ALTER TABLE "SlackOAuthConfig" ADD COLUMN "signingSecret" TEXT;

-- Data fix: SlackIntegration.signingSecret was populated by the OAuth callback
-- with tokenData.authed_user.id — the Slack user ID of whoever installed the
-- app, not a signing secret. It can never verify a signature, so clear it
-- rather than leave a mislabelled value that looks configured.
UPDATE "SlackIntegration" SET "signingSecret" = NULL WHERE "signingSecret" IS NOT NULL;
