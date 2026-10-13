CREATE TABLE "AuthenticationAlertFanout" (
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthenticationAlertFanout_pkey" PRIMARY KEY ("eventId")
);
CREATE INDEX "AuthenticationAlertFanout_createdAt_idx" ON "AuthenticationAlertFanout"("createdAt");
