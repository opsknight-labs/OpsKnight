CREATE TABLE "DependencyObservationBucket" (
  bucket TIMESTAMP(3) NOT NULL,
  "serviceId" TEXT NOT NULL,
  "firstIncidentAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DependencyObservationBucket_pkey" PRIMARY KEY (bucket, "serviceId"),
  CONSTRAINT "DependencyObservationBucket_serviceId_fkey" FOREIGN KEY ("serviceId")
    REFERENCES "Service"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
