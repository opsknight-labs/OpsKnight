ALTER TABLE "McpPolicy" ADD COLUMN "dcrEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dcrScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "McpClient" ADD COLUMN "dynamicRegistration" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstAuthorizedAt" TIMESTAMP(3);
ALTER TABLE "McpClient" ADD CONSTRAINT "McpClient_registration_kind_check"
  CHECK (NOT "dynamicRegistration" OR "metadataUrl" IS NULL);
CREATE INDEX "McpClient_dynamicRegistration_createdAt_idx" ON "McpClient"("dynamicRegistration", "createdAt");
