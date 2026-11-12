-- Opt-in: routine responder changes may run over MCP without a review. Off by default.
ALTER TABLE "McpPolicy" ADD COLUMN "responderDirectWritesEnabled" BOOLEAN NOT NULL DEFAULT false;
