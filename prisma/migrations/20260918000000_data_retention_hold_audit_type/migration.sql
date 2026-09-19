-- Add DATA_RETENTION_HOLD to AuditEntityType.
-- Enum value additions must ship alone (see scripts/validate-migrations.cjs);
-- the table that uses this value is created in the next migration.
ALTER TYPE "AuditEntityType" ADD VALUE 'DATA_RETENTION_HOLD';