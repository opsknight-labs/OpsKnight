CREATE TYPE "NotificationEndpointStatus" AS ENUM (
  'HEALTHY', 'UNVERIFIED', 'DEGRADED', 'INVALID', 'BOUNCED', 'OPTED_OUT'
);

ALTER TABLE "Notification" ADD COLUMN "reconciliationDeadline" TIMESTAMP(3);
ALTER TABLE "NotificationDeliveryAttempt" ADD COLUMN "reconciliationDeadline" TIMESTAMP(3);

CREATE TABLE "UserNotificationEndpoint" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "addressHash" TEXT,
  "status" "NotificationEndpointStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNotificationEndpoint_userId_channel_key"
  ON "UserNotificationEndpoint"("userId", "channel");
CREATE INDEX "UserNotificationEndpoint_status_channel_idx"
  ON "UserNotificationEndpoint"("status", "channel");
ALTER TABLE "UserNotificationEndpoint"
  ADD CONSTRAINT "UserNotificationEndpoint_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
