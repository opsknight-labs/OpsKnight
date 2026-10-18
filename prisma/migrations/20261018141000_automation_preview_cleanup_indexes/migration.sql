CREATE INDEX "AutomationContextObservation_pending_preview_cleanup"
ON "AutomationContextObservation" (id) WHERE "rawValuePreview" <> '';
CREATE INDEX "BackgroundJob_pending_preview_cleanup"
ON "BackgroundJob" (id) WHERE type = 'SCHEDULED_TASK'::"JobType"
AND payload->>'task' = 'AUTOMATION_OBSERVE'
AND payload @? '$.observations[*] ? (@.value != "")';
