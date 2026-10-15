ALTER TABLE "ServiceRunbookBinding" ADD COLUMN "detachedAt" TIMESTAMP(3);
CREATE INDEX "ServiceRunbookBinding_serviceId_id_idx" ON "ServiceRunbookBinding"("serviceId", "id");
