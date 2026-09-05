CREATE TYPE "WarRoomProvisioningStatus" AS ENUM ('NONE', 'PROVISIONING', 'READY', 'FAILED');

ALTER TABLE "Incident"
  ADD COLUMN "warRoomProvisioningStatus" "WarRoomProvisioningStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "warRoomProvisioningToken" TEXT,
  ADD COLUMN "warRoomProvisioningAt" TIMESTAMP(3);

CREATE INDEX "Incident_warRoomProvisioningStatus_warRoomProvisioningAt_idx"
  ON "Incident"("warRoomProvisioningStatus", "warRoomProvisioningAt");
