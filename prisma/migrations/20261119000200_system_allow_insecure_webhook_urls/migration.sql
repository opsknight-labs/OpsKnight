-- Admin switch: allow outgoing service webhooks to use http:// URLs (HTTPS stays the default).
ALTER TABLE "SystemSettings" ADD COLUMN "allowInsecureWebhookUrls" BOOLEAN NOT NULL DEFAULT false;
