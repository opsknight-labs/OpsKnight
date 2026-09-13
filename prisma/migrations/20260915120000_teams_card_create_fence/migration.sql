ALTER TABLE "MicrosoftTeamsIncidentMessage"
  ADD COLUMN "createOperationId" TEXT,
  ADD COLUMN "createState" TEXT NOT NULL DEFAULT 'NONE';

CREATE INDEX "MicrosoftTeamsIncidentMessage_createState_idx"
  ON "MicrosoftTeamsIncidentMessage"("createState");

ALTER TABLE "MicrosoftTeamsIncidentMessage"
  ADD CONSTRAINT "MicrosoftTeamsIncidentMessage_createState_check"
  CHECK ("createState" IN ('NONE', 'CREATING', 'AMBIGUOUS'));
