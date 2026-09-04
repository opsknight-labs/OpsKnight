-- Webhook display names are service-local configuration. A global uniqueness
-- constraint prevented independent services from both using conventional names
-- such as "Microsoft Teams".
DROP INDEX IF EXISTS "WebhookIntegration_name_key";

CREATE UNIQUE INDEX "WebhookIntegration_serviceId_name_key"
ON "WebhookIntegration"("serviceId", "name");
