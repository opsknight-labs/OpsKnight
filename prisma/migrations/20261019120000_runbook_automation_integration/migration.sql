-- Runbook ↔ Service Automation integration: enum values only; columns follow in the next migration.

ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RUNBOOK_SKIPPED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RUNBOOK_VERIFIED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'RUNBOOK_UNVERIFIED';
ALTER TYPE "RunbookConditionOperator" ADD VALUE IF NOT EXISTS 'IS_MISSING';
ALTER TYPE "RunbookConditionOperator" ADD VALUE IF NOT EXISTS 'IS_UNMAPPED';
