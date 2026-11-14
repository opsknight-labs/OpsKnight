-- Marks rows written on behalf of an AI assistant ("mcp:<clientId>"). The default reads a
-- transaction-local setting, so it is set separately from ADD COLUMN: existing rows stay NULL
-- and neither table is rewritten.
ALTER TABLE "IncidentEvent" ADD COLUMN "channel" TEXT;
ALTER TABLE "IncidentEvent" ALTER COLUMN "channel"
  SET DEFAULT NULLIF(current_setting('opsknight.channel'::text, true), ''::text);
ALTER TABLE "IncidentNote" ADD COLUMN "channel" TEXT;
ALTER TABLE "IncidentNote" ALTER COLUMN "channel"
  SET DEFAULT NULLIF(current_setting('opsknight.channel'::text, true), ''::text);
ALTER TABLE "AuditLog" ADD COLUMN "channel" TEXT;
