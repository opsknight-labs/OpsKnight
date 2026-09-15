-- Unified ChatOps: durable planned external channel identity.
-- Stored before conversations.create and never overwritten by reconciliation;
-- lost-response recovery reconciles only this exact name + marker.
ALTER TABLE "IncidentWarRoom" ADD COLUMN IF NOT EXISTS "plannedExternalName" TEXT;
