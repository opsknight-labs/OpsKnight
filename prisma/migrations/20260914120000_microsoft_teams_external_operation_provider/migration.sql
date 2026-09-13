-- Extend ExternalIssueProvider for Microsoft Teams claim-first delivery
-- Isolated per OpsKnight migration rules (no other operations in same file)
ALTER TYPE "ExternalIssueProvider" ADD VALUE IF NOT EXISTS 'MICROSOFT_TEAMS';
