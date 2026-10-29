-- Additive and default-off: administrator opt-in for reviewed sensitive configuration reads.
ALTER TABLE "McpPolicy" ADD COLUMN "sensitiveReadsEnabled" BOOLEAN NOT NULL DEFAULT false;
