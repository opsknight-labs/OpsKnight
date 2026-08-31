-- Generalize the durable notification ledger without changing the existing
-- user-specific incident history contract. Existing rows retain INCIDENT/USER
-- defaults; new system deliveries can target external recipients safely.
CREATE TYPE "NotificationCategory" AS ENUM (
  'INCIDENT',
  'SECURITY',
  'STATUS_PAGE',
  'SLA',
  'ADMINISTRATION',
  'SYSTEM'
);

CREATE TYPE "NotificationRecipientType" AS ENUM (
  'USER',
  'EMAIL',
  'PHONE',
  'SUBSCRIBER',
  'SLACK_CHANNEL',
  'WEBHOOK'
);

ALTER TABLE "Notification"
  ALTER COLUMN "incidentId" DROP NOT NULL,
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'INCIDENT',
  ADD COLUMN "recipientType" "NotificationRecipientType" NOT NULL DEFAULT 'USER',
  ADD COLUMN "recipientId" TEXT,
  ADD COLUMN "recipientDisplay" TEXT,
  ADD COLUMN "recipientHash" TEXT,
  ADD COLUMN "templateKey" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "deliveryKey" TEXT,
  ADD COLUMN "payloadEncrypted" TEXT,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_priority_check" CHECK ("priority" BETWEEN 0 AND 9),
  ADD CONSTRAINT "Notification_maxAttempts_check" CHECK ("maxAttempts" BETWEEN 1 AND 20),
  ADD CONSTRAINT "Notification_target_check" CHECK (
    "userId" IS NOT NULL OR
    ("recipientId" IS NOT NULL AND "recipientHash" IS NOT NULL)
  ),
  ADD CONSTRAINT "Notification_generic_payload_check" CHECK (
    "category" = 'INCIDENT' OR "payloadEncrypted" IS NOT NULL
  );

CREATE UNIQUE INDEX "Notification_deliveryKey_key" ON "Notification"("deliveryKey");
CREATE INDEX "idx_notification_delivery_due"
  ON "Notification"("status", "nextAttemptAt", "priority", "createdAt");
CREATE INDEX "idx_notification_category_created"
  ON "Notification"("category", "createdAt");
CREATE INDEX "idx_notification_recipient_created"
  ON "Notification"("recipientHash", "createdAt");
CREATE INDEX "idx_notification_source_created"
  ON "Notification"("sourceType", "sourceId", "createdAt");
CREATE INDEX "idx_notification_created_cursor"
  ON "Notification"("createdAt", "id");

CREATE TABLE "NotificationDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "provider" TEXT,
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "latencyMs" INTEGER,
  CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDeliveryAttempt_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationDeliveryAttempt_notificationId_ordinal_key"
  ON "NotificationDeliveryAttempt"("notificationId", "ordinal");
CREATE INDEX "NotificationDeliveryAttempt_notificationId_startedAt_idx"
  ON "NotificationDeliveryAttempt"("notificationId", "startedAt");
CREATE INDEX "NotificationDeliveryAttempt_outcome_startedAt_idx"
  ON "NotificationDeliveryAttempt"("outcome", "startedAt");
