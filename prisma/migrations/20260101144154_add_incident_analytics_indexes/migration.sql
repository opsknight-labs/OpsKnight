-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_acknowledgedAt_idx" ON "Incident"("acknowledgedAt");

-- CreateIndex
CREATE INDEX "Incident_resolvedAt_idx" ON "Incident"("resolvedAt");
