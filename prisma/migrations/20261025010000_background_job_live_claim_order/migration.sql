-- Retained terminal jobs must not precede due work in an ordered claim scan.
-- Keep the existing type, lease, attempt, lane and predecessor filters in the
-- application query. This index changes access cost, never claim eligibility.
CREATE INDEX "BackgroundJob_claim_live_order_idx"
ON "BackgroundJob" ("scheduledAt", "createdAt", "id")
WHERE "status" IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus",
  'PENDING_V2'::"JobStatus", 'PROCESSING_V2'::"JobStatus")
  AND "attempts" < "maxAttempts";
