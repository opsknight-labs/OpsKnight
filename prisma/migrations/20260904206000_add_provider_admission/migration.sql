CREATE TABLE "ProviderAdmission" (
  "key" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'CLOSED',
  "blockedUntil" TIMESTAMP(3),
  "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderAdmission_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ProviderAdmission_state_blockedUntil_idx"
ON "ProviderAdmission"("state", "blockedUntil");
