-- Historical feedback did not record whether it matched at ingestion. Repair only
-- idempotent authentication transport state using recorded provider evidence;
-- never replay subscription/endpoint counters whose prior effects are unknown.
WITH receipts AS (
  SELECT DISTINCT ON (n.id) n.id, f."eventType", f."occurredAt"
  FROM "Notification" n JOIN "NotificationProviderFeedback" f
    ON f."providerMessageId" = n."providerMessageId" AND f.provider = n."deliveryProvider"
  WHERE n."sourceType" = 'AUTHENTICATION'
    AND n."templateKey" = 'authentication-security-alert'
    AND f."eventType" IN ('DELIVERED','HARD_BOUNCE','INVALID_RECIPIENT','COMPLAINT','SUPPRESSION')
  ORDER BY n.id, (f."eventType" <> 'DELIVERED') DESC, f."occurredAt" DESC, f.id DESC
)
UPDATE "Notification" n SET
  status = CASE WHEN r."eventType" = 'DELIVERED' THEN 'DELIVERED'::"NotificationStatus" ELSE 'FAILED'::"NotificationStatus" END,
  "deliveredAt" = CASE WHEN r."eventType" = 'DELIVERED' THEN r."occurredAt" ELSE NULL END,
  "failedAt" = CASE WHEN r."eventType" = 'DELIVERED' THEN NULL ELSE r."occurredAt" END,
  attempts = CASE WHEN r."eventType" = 'DELIVERED' THEN n.attempts ELSE GREATEST(n.attempts,n."maxAttempts") END,
  "payloadEncrypted" = NULL
FROM receipts r WHERE n.id = r.id
  AND (n.status IN ('SENT','UNKNOWN','DELIVERED') OR
       (n.status = 'FAILED' AND (r."eventType" <> 'DELIVERED' OR n.attempts < n."maxAttempts")));

UPDATE "AuthenticationAlert" a SET "deliveredAt" = n."deliveredAt", "lastError" = NULL
FROM "Notification" n WHERE a."notificationId" = n.id AND n.status = 'DELIVERED'
  AND n."deliveredAt" IS NOT NULL AND a."failedAt" IS NULL AND a."cancelledAt" IS NULL;
UPDATE "AuthenticationAlert" a SET "failedAt" = n."failedAt", "deliveredAt" = NULL,
  "lastError" = 'Provider reported terminal delivery failure. Review provider feedback before retrying.'
FROM "Notification" n WHERE a."notificationId" = n.id AND n.status = 'FAILED'
  AND n.attempts >= n."maxAttempts" AND n."failedAt" IS NOT NULL AND a."cancelledAt" IS NULL;
