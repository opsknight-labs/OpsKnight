-- AlterTable
ALTER TABLE "Team" ADD COLUMN "scimExternalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Team_scimExternalId_key" ON "Team"("scimExternalId");
