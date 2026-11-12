-- Audit entity types for access control. Enum value additions must be committed in their own
-- migration before any statement may use them.
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_REQUEST';
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_GRANT';
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_DECISION';
ALTER TYPE "AuditEntityType" ADD VALUE 'CUSTOM_ROLE';
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_REVIEW';
