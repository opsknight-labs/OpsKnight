-- Safe date parser that catches any malformed legacy date and returns NULL instead of failing
CREATE OR REPLACE FUNCTION opsknight_try_parse_timestamptz(val text)
RETURNS timestamptz AS $$
BEGIN
  IF val IS NULL OR btrim(val) = '' THEN
    RETURN NULL;
  END IF;
  RETURN val::timestamptz;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Backfill legacy Postmortem.actionItems JSON into normalized ActionItem rows.
-- Idempotent: skips if ActionItem rows already exist for the postmortem.
INSERT INTO "ActionItem" (
  "id",
  "postmortemId",
  "incidentId",
  "title",
  "description",
  "ownerId",
  "dueDate",
  "status",
  "priority",
  "source",
  "createdAt",
  "updatedAt",
  "completedAt"
)
SELECT
  'ai_' || regexp_replace(p.id, '[^a-zA-Z0-9_-]', '_', 'g') || '_' || regexp_replace(COALESCE(elem->>'id', 'index_' || (elem_idx - 1)), '[^a-zA-Z0-9_-]', '_', 'g'),
  p.id,
  p."incidentId",
  COALESCE(NULLIF(TRIM(elem->>'title'), ''), 'Untitled action item'),
  NULLIF(TRIM(elem->>'description'), ''),
  u.id,
  opsknight_try_parse_timestamptz(elem->>'dueDate'),
  CASE
    WHEN elem->>'status' IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED') THEN (elem->>'status')::"ActionItemStatus"
    ELSE 'OPEN'::"ActionItemStatus"
  END,
  CASE
    WHEN elem->>'priority' IN ('HIGH', 'MEDIUM', 'LOW') THEN (elem->>'priority')::"ActionItemPriority"
    ELSE 'MEDIUM'::"ActionItemPriority"
  END,
  'POSTMORTEM'::"ActionItemSource",
  COALESCE(p."createdAt", NOW()),
  COALESCE(p."updatedAt", NOW()),
  CASE
    WHEN elem->>'status' = 'COMPLETED' THEN COALESCE(p."updatedAt", NOW())
    ELSE NULL
  END
FROM "Postmortem" p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(p."actionItems"::jsonb) = 'array' THEN p."actionItems"::jsonb
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS t(elem, elem_idx)
LEFT JOIN "User" u ON u.id = (elem->>'owner')
WHERE p."actionItems" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ActionItem" ai WHERE ai."postmortemId" = p.id
  )
ON CONFLICT ("id") DO NOTHING;

-- Clean up temporary parsing helper
DROP FUNCTION IF EXISTS opsknight_try_parse_timestamptz(text);

-- CreateIndex for deterministic paginated sorting on ActionItem
CREATE INDEX IF NOT EXISTS "ActionItem_createdAt_id_idx" ON "ActionItem"("createdAt", "id");
