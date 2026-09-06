CREATE TABLE "IncidentSlaPause" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "reason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "lifecycleGeneration" INTEGER NOT NULL DEFAULT 0,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentSlaPause_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncidentSlaPause_incidentId_fkey" FOREIGN KEY ("incidentId")
    REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IncidentSlaPause_valid_interval" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);

CREATE INDEX "IncidentSlaPause_incidentId_startedAt_idx"
  ON "IncidentSlaPause"("incidentId", "startedAt");
CREATE INDEX "IncidentSlaPause_incidentId_endedAt_idx"
  ON "IncidentSlaPause"("incidentId", "endedAt");
CREATE UNIQUE INDEX "IncidentSlaPause_one_open_per_incident_idx"
  ON "IncidentSlaPause"("incidentId") WHERE "endedAt" IS NULL;
