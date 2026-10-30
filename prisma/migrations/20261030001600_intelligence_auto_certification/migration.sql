CREATE INDEX "idx_intelligence_cert_service_recent" ON "IntelligenceEvaluationRun"
  (("metrics"->>'serviceId'), "completedAt" DESC)
  WHERE "kind" = 'CERTIFICATION' AND "status" = 'COMPLETED';
CREATE INDEX "idx_intelligence_quality_reviews" ON "IncidentRelationshipEvent" ("createdAt" DESC)
  WHERE "actorType" = 'USER';

CREATE TABLE "AiTokenReservation" (
  "id" TEXT PRIMARY KEY, "day" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "tokens" INTEGER NOT NULL CHECK ("tokens" > 0 AND "tokens" <= 2000000),
  "expiresAt" TIMESTAMP(3) NOT NULL, "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "idx_ai_token_reservation_day" ON "AiTokenReservation" ("day", "expiresAt");
CREATE INDEX "idx_ai_token_reservation_actor" ON "AiTokenReservation" ("day", "actorId", "expiresAt");
CREATE INDEX "idx_ai_token_reservation_retention" ON "AiTokenReservation" ("expiresAt");
