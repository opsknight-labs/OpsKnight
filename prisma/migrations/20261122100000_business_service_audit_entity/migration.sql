-- Own file: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'BUSINESS_SERVICE';
