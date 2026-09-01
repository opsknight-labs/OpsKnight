-- Manual escalation is audited against the incident it pages for, so the audit
-- entity taxonomy needs the incident itself. Additive and reversible: no
-- existing row references the new value.
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'INCIDENT';
