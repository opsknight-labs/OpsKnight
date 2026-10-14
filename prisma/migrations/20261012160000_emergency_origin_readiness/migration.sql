-- A drill at another RP/origin cannot certify recovery for this deployment.
ALTER TABLE "EmergencyAccount" ADD COLUMN "verifiedOrigin" TEXT;
