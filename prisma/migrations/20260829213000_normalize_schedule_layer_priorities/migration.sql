-- Preserve the existing effective order (priority first, creation order for ties)
-- while ensuring every layer in a schedule has a unique precedence value.
WITH ranked_layers AS (
  SELECT
    "id",
    COUNT(*) OVER (PARTITION BY "scheduleId")
      - ROW_NUMBER() OVER (
          PARTITION BY "scheduleId"
          ORDER BY "priority" DESC, "createdAt" ASC, "id" ASC
        )::integer AS normalized_priority
  FROM "OnCallLayer"
)
UPDATE "OnCallLayer" AS layer
SET "priority" = ranked_layers.normalized_priority
FROM ranked_layers
WHERE layer."id" = ranked_layers."id";
