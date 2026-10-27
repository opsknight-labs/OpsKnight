-- Additive and default-off: Client ID Metadata Documents for MCP OAuth clients.
ALTER TABLE "McpPolicy"
  ADD COLUMN "cimdEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cimdAllowedHosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "cimdScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "McpClient"
  ADD COLUMN "metadataUrl" TEXT,
  ADD COLUMN "metadataFetchedAt" TIMESTAMP(3);

-- A metadata-identified client's id is always its document URL.
ALTER TABLE "McpClient" ADD CONSTRAINT "mcp_client_metadata_identity"
CHECK ("metadataUrl" IS NULL OR "metadataUrl" = "id");
