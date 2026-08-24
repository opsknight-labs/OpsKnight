-- Foreign-key indexes used by schedule, team, and integration hot paths.
-- CREATE INDEX IF NOT EXISTS keeps rolling upgrades and recovery reruns safe.
CREATE INDEX IF NOT EXISTS "TeamMember_teamId_idx" ON "TeamMember"("teamId");
CREATE INDEX IF NOT EXISTS "Integration_serviceId_idx" ON "Integration"("serviceId");
CREATE INDEX IF NOT EXISTS "OnCallLayer_scheduleId_idx" ON "OnCallLayer"("scheduleId");
CREATE INDEX IF NOT EXISTS "OnCallShift_scheduleId_idx" ON "OnCallShift"("scheduleId");
