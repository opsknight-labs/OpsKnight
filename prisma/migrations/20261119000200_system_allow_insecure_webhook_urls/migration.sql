-- Admin switch: allow outgoing service webhooks to use http:// URLs (HTTPS stays the default).
ALTER TABLE "SystemSettings" ADD COLUMN "allowInsecureWebhookUrls" BOOLEAN NOT NULL DEFAULT false;

-- HTTPS is now enforced at send time as well. Installs that already deliver to http://
-- service webhooks keep working: the switch starts on for them, and admins can turn it off.
INSERT INTO "SystemSettings" ("id", "allowInsecureWebhookUrls", "updatedAt")
SELECT 'default', true, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "WebhookIntegration" WHERE "url" ILIKE 'http://%')
ON CONFLICT ("id") DO UPDATE SET "allowInsecureWebhookUrls" = true;
