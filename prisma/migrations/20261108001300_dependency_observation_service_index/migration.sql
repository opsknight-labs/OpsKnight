CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dependency_observation_service"
ON "DependencyObservationBucket" ("serviceId", bucket);
