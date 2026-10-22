CREATE INDEX "StatusPageSubscription_statusPageId_subscribedAt_id_idx"
ON "StatusPageSubscription" ("statusPageId", "subscribedAt", id);
