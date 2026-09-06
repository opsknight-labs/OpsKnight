-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "serviceId" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SLADefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetAckTime" INTEGER,
    "targetResolveTime" INTEGER,
    "serviceId" TEXT,
    "priority" TEXT,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SLADefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SLASnapshot" (
    "id" TEXT NOT NULL,
    "slaDefinitionId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalIncidents" INTEGER NOT NULL,
    "metAckTime" INTEGER NOT NULL,
    "metResolveTime" INTEGER NOT NULL,
    "complianceScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SLASnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogEntry_timestamp_idx" ON "LogEntry"("timestamp");

-- CreateIndex
CREATE INDEX "LogEntry_serviceId_timestamp_idx" ON "LogEntry"("serviceId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "SLASnapshot_date_slaDefinitionId_key" ON "SLASnapshot"("date", "slaDefinitionId");

-- AddForeignKey
ALTER TABLE "SLASnapshot" ADD CONSTRAINT "SLASnapshot_slaDefinitionId_fkey" FOREIGN KEY ("slaDefinitionId") REFERENCES "SLADefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
