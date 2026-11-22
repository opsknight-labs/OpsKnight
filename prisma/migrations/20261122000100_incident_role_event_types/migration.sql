-- Timeline event types for incident roles. Enum value additions must be committed in their own
-- migration before any statement may use them.
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'ROLE_ASSIGNED';
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'ROLE_UNASSIGNED';
