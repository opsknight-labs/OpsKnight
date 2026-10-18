ALTER TABLE "SystemSettings" ADD COLUMN "automationReadinessPolicy" JSONB NOT NULL
DEFAULT '{"minimumEvaluations":100,"maximumEvidenceAgeHours":48,"maximumPendingObservations":0,"maximumErrorRate":0}';
CREATE INDEX "automation_readiness_pending_version_idx" ON "BackgroundJob"
((payload->>'serviceId'), (payload->'shadow'->>'versionId'), "scheduledAt", id)
WHERE type = 'SCHEDULED_TASK'::"JobType" AND status IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus")
AND payload->>'task' = 'AUTOMATION_OBSERVE';
