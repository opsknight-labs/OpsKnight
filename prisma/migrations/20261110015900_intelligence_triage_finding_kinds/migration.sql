-- Enum additions split out of 20261110020000_intelligence_triage_change_risk_topology: ALTER TYPE ... ADD VALUE must not share a migration with other DDL.
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_URGENCY';
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_ASSIGNMENT';
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_DUPLICATE';
ALTER TYPE "IntelligenceFindingKind" ADD VALUE IF NOT EXISTS 'TRIAGE_RESOLUTION_TIME';
