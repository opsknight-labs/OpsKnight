-- Persist resolve-driven close intent for AMBIGUOUS rooms so the close lifecycle
-- can wait for external identity resolution before terminalizing.
ALTER TABLE "IncidentWarRoom" ADD COLUMN IF NOT EXISTS "closeRequestedAt" TIMESTAMP;
