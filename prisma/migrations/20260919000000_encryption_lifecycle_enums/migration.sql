-- Add ENCRYPTION_MIGRATION to AuditEntityType and ENCRYPTION_LIFECYCLE to JobType.
-- Enum value additions must ship alone (see scripts/validate-migrations.cjs).
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'ENCRYPTION_MIGRATION';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ENCRYPTION_LIFECYCLE';
