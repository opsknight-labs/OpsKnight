-- Connections granted by the organization's identity provider (Enterprise-Managed Authorization).
ALTER TABLE "McpGrant" DROP CONSTRAINT "McpGrant_kind_check";
ALTER TABLE "McpGrant" ADD CONSTRAINT "McpGrant_kind_check" CHECK ("kind" IN ('OAUTH', 'PAT', 'IDP'));
