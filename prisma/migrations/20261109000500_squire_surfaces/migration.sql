-- Squire surfaces (Slack/Teams, MCP, mobile): three opt-in switches, all off by default.
-- Constant defaults: PostgreSQL stores them in the catalog, so the single settings row is not rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';
ALTER TABLE "AiSettings" ADD COLUMN "squireChatOpsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiSettings" ADD COLUMN "squireMcpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiSettings" ADD COLUMN "squireMobileEnabled" BOOLEAN NOT NULL DEFAULT false;
RESET statement_timeout;
RESET lock_timeout;
