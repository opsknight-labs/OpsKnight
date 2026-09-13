-- Generic ChatOpsIntent for Slack + Teams
-- Provider-neutral intent inbox: Slack (DEFERRED response_url) and Teams (INLINE invoke response) share the same durable queue.
-- Preserves Slack back-compat: existing rows are backfilled to provider=SLACK, responseMode=DEFERRED.

-- Create provider and response mode enums (isolated, committed before use)
CREATE TYPE "ChatProvider" AS ENUM ('SLACK', 'MICROSOFT_TEAMS');
CREATE TYPE "ChatOpsResponseMode" AS ENUM ('INLINE', 'DEFERRED');

-- Add provider/responseMode/payloadDigest columns
ALTER TABLE "ChatOpsIntent" ADD COLUMN IF NOT EXISTS "provider" "ChatProvider" NOT NULL DEFAULT 'SLACK';
ALTER TABLE "ChatOpsIntent" ADD COLUMN IF NOT EXISTS "responseMode" "ChatOpsResponseMode" NOT NULL DEFAULT 'DEFERRED';
ALTER TABLE "ChatOpsIntent" ADD COLUMN IF NOT EXISTS "payloadDigest" TEXT;

-- Backfill existing rows explicitly (DEFAULT already fills, but be explicit for rolling deploy safety)
UPDATE "ChatOpsIntent" SET "provider" = 'SLACK' WHERE "provider" IS NULL;
UPDATE "ChatOpsIntent" SET "responseMode" = 'DEFERRED' WHERE "responseMode" IS NULL;

-- Migrate unique constraint from (kind, deliveryHash) to (provider, kind, deliveryHash)
-- The old Prisma unique @@unique([kind, deliveryHash]) created index "ChatOpsIntent_kind_deliveryHash_key"
DROP INDEX IF EXISTS "ChatOpsIntent_kind_deliveryHash_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChatOpsIntent_provider_kind_deliveryHash_key"
  ON "ChatOpsIntent"("provider", "kind", "deliveryHash");

-- Provider-scoped lease polling index
CREATE INDEX IF NOT EXISTS "ChatOpsIntent_provider_status_leaseExpiresAt_idx"
  ON "ChatOpsIntent"("provider", "status", "leaseExpiresAt");

-- Remove defaults after migration (Prisma manages defaults at application layer; keep column defaults for safety)
-- Keep defaults on provider/responseMode to handle legacy writers during rolling deploy
