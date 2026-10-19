-- Recover receipts quarantined by the previous infrastructure/age limit. Invalid
-- targets/types remain terminal; provider-matched receipts can be applied safely.
UPDATE "NotificationProviderFeedback" f
SET "quarantinedAt" = NULL, "nextReconcileAt" = CURRENT_TIMESTAMP
WHERE f."processedAt" IS NULL AND f."quarantinedAt" IS NOT NULL AND (
  f."reconciliationReason" IN ('RECONCILIATION_ERROR','RECONCILIATION_EXHAUSTED') OR
  (f."reconciliationReason" = 'UNMATCHED_PROVIDER_MESSAGE' AND EXISTS (
    SELECT 1 FROM "Notification" n WHERE n."providerMessageId" = f."providerMessageId"
      AND (n."deliveryProvider" = f.provider OR
        (n."deliveryProvider" IS NULL AND EXISTS (
          SELECT 1 FROM "NotificationDeliveryAttempt" a WHERE a."notificationId" = n.id
            AND a."providerMessageId" = f."providerMessageId" AND a.provider = f.provider
        )))
  ))
);
