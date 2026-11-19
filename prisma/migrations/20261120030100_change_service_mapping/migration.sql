-- Additive only: one nullable column, a NOT VALID foreign key (validated in 20261120030300) and two small new tables.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "ChangeEvent" ADD COLUMN "unmappedIntegrationId" TEXT;
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_unmappedIntegrationId_fkey"
  FOREIGN KEY ("unmappedIntegrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

CREATE TABLE "ChangeServiceMapping" (
  "integrationId" TEXT NOT NULL,
  "mappings" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChangeServiceMapping_pkey" PRIMARY KEY ("integrationId")
);
ALTER TABLE "ChangeServiceMapping" ADD CONSTRAINT "ChangeServiceMapping_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CatalogServiceAlias" (
  "name" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogServiceAlias_pkey" PRIMARY KEY ("name")
);
CREATE INDEX "CatalogServiceAlias_serviceId_idx" ON "CatalogServiceAlias"("serviceId");
ALTER TABLE "CatalogServiceAlias" ADD CONSTRAINT "CatalogServiceAlias_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

RESET statement_timeout;
RESET lock_timeout;
