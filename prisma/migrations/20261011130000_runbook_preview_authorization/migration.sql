CREATE TABLE "RunbookPreviewAuthorization" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "incidentId" TEXT,
    "serviceId" TEXT,
    "bindingId" TEXT,
    "suggestionId" TEXT,
    "planDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "executionId" TEXT,
    CONSTRAINT "RunbookPreviewAuthorization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunbookPreviewAuthorization_executionId_key" ON "RunbookPreviewAuthorization"("executionId");
CREATE INDEX "RunbookPreviewAuthorization_expiresAt_idx" ON "RunbookPreviewAuthorization"("expiresAt");
CREATE INDEX "RunbookPreviewAuthorization_actorId_createdAt_idx" ON "RunbookPreviewAuthorization"("actorId", "createdAt");
