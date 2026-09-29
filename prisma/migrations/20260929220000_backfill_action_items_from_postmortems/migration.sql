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
  CASE
    WHEN elem->>'dueDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'dueDate')::timestamptz
    ELSE NULL
  END,
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
