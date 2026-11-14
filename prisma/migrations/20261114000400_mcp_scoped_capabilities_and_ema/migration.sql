-- Per-role and per-assistant capability narrowing, and the opt-in for IdP-managed MCP access.
ALTER TABLE "McpPolicy" ADD COLUMN "roleDisabledCapabilities" JSONB;
ALTER TABLE "McpPolicy" ADD COLUMN "enterpriseManagedAuthEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "McpClient" ADD COLUMN "disabledCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];
