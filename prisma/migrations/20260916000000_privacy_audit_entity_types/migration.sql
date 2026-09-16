-- Enum value additions must be their own migration and commit before any
-- application code or later migration can reference the new values.
ALTER TYPE "AuditEntityType" ADD VALUE 'PRIVACY_REQUEST';
ALTER TYPE "AuditEntityType" ADD VALUE 'PRIVACY_EXPORT_ARTIFACT';
