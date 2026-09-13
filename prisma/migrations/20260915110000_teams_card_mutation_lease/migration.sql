ALTER TABLE "MicrosoftTeamsIncidentMessage"
  ADD COLUMN "mutationLeaseToken" TEXT,
  ADD COLUMN "mutationLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "MicrosoftTeamsIncidentMessage_mutationLeaseExpiresAt_idx"
  ON "MicrosoftTeamsIncidentMessage"("mutationLeaseExpiresAt");
