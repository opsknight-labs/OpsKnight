ALTER TABLE "User"
ADD COLUMN "scimExternalId" TEXT;

CREATE UNIQUE INDEX "User_scimExternalId_key" ON "User"("scimExternalId");
