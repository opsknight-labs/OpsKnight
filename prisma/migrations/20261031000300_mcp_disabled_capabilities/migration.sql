-- Additive: capabilities an administrator never exposes through MCP. Empty by default, so nothing
-- changes until an administrator disables something.
ALTER TABLE "McpPolicy" ADD COLUMN "disabledCapabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
