-- Incident roles (commander, ops lead, comms lead, scribe): one holder per role per incident.
-- New table, so its indexes are built inline; the only change to an existing table is an
-- optional column.
ALTER TABLE "IncidentTemplate" ADD COLUMN IF NOT EXISTS "defaultRoles" JSONB;

CREATE TABLE "IncidentRoleAssignment" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncidentRoleAssignment_incidentId_roleKey_key" ON "IncidentRoleAssignment"("incidentId", "roleKey");
CREATE INDEX "IncidentRoleAssignment_userId_idx" ON "IncidentRoleAssignment"("userId");

ALTER TABLE "IncidentRoleAssignment" ADD CONSTRAINT "IncidentRoleAssignment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentRoleAssignment" ADD CONSTRAINT "IncidentRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentRoleAssignment" ADD CONSTRAINT "IncidentRoleAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
