-- A small index over unfinished invitation work avoids scanning notification history.
-- Keep the literal predicate aligned with the bounded shared invitation admission query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_invitation_admission_idx"
ON "Notification" ("expiresAt", id)
WHERE "sourceType" = 'USER_INVITATION'
  AND status IN ('PENDING'::"NotificationStatus", 'FAILED'::"NotificationStatus", 'UNKNOWN'::"NotificationStatus");
