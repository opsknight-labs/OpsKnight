-- Selective subscriber fanout: materialize JSON array into indexed join
-- Existing JSON `preferences.selectedServiceIds` is backfilled, then writers maintain both stores.

CREATE TABLE IF NOT EXISTS "StatusPageSubscriptionService" (
  "subscriptionId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "StatusPageSubscriptionService_pkey" PRIMARY KEY ("subscriptionId", "serviceId"),
  CONSTRAINT "StatusPageSubscriptionService_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "StatusPageSubscription"("id") ON DELETE CASCADE,
  CONSTRAINT "StatusPageSubscriptionService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "StatusPageSubscriptionService_serviceId_idx" ON "StatusPageSubscriptionService"("serviceId");
CREATE INDEX IF NOT EXISTS "StatusPageSubscriptionService_subscriptionId_idx" ON "StatusPageSubscriptionService"("subscriptionId");

-- Advisory: index for fanout fast path — verified + not unsubscribed + scoped to one service.
-- Partial index keeps "all-services" subscribers (empty join) on the fallback path.

-- Backfill: expand all non-empty `preferences.selectedServiceIds` JSON arrays.
INSERT INTO "StatusPageSubscriptionService" ("subscriptionId", "serviceId")
SELECT sub."id", elem::text
FROM "StatusPageSubscription" sub,
     LATERAL jsonb_array_elements_text(COALESCE((sub."preferences"->'selectedServiceIds')::jsonb, '[]'::jsonb)) AS elem
WHERE sub."preferences" IS NOT NULL
  AND jsonb_typeof(sub."preferences"->'selectedServiceIds') = 'array'
  AND (sub."preferences"->'selectedServiceIds')::text <> '[]'
  AND EXISTS (SELECT 1 FROM "Service" s WHERE s."id" = elem::text)
ON CONFLICT DO NOTHING;
