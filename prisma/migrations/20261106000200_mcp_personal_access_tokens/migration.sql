-- Additive. Personal access tokens reuse McpGrant and McpToken: a grant of kind 'PAT' has one
-- token whose access secret is the personal token and which can never be refreshed. Existing
-- grants are OAuth connections and keep working unchanged.
ALTER TABLE "McpGrant" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'OAUTH';
ALTER TABLE "McpGrant" ADD COLUMN "label" TEXT;
-- Set once the owner was told the personal token expires within seven days.
ALTER TABLE "McpGrant" ADD COLUMN "expiryNotifiedAt" TIMESTAMP(3);
ALTER TABLE "McpGrant" ADD CONSTRAINT "McpGrant_kind_check" CHECK ("kind" IN ('OAUTH', 'PAT'));
-- The expiry-notice sweep and the "turn tokens off" revocation read live tokens by kind.
CREATE INDEX "McpGrant_kind_expiresAt_idx" ON "McpGrant"("kind", "expiresAt");

-- Personal tokens are off until an administrator turns them on; then at most patMaxDays long
-- (hard cap 90) and limited to patAllowedScopes. "Require view-only connections" caps every
-- connection, OAuth and personal, to read scopes.
ALTER TABLE "McpPolicy" ADD COLUMN "patEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "McpPolicy" ADD COLUMN "patMaxDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "McpPolicy" ADD COLUMN "patAllowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "McpPolicy" ADD COLUMN "requireReadOnlyConnections" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "McpPolicy" ADD CONSTRAINT "McpPolicy_patMaxDays_check"
  CHECK ("patMaxDays" BETWEEN 1 AND 90);
