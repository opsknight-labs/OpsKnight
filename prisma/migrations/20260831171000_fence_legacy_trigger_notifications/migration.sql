-- Pre-generation triggered IDs cannot prove which escalation generation they
-- belong to. Do not replay them after the durable generation migration: a
-- concurrent current worker may create the equivalent g0 intent, and sending
-- both would duplicate a responder notification.
UPDATE "Notification"
SET
  "status" = 'SKIPPED',
  "lastAttemptAt" = NULL,
  "errorMsg" = 'Triggered notification predates immutable escalation generation.'
WHERE
  "status" IN ('PENDING', 'FAILED')
  AND "eventType" = 'triggered'
  AND "id" LIKE 'ntf:triggered:%'
  AND "id" NOT LIKE 'ntf:triggered:%:g%:%';
