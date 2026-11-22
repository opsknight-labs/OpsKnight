-- Multiple disabled triggers may retain historical suggestion/execution references.
-- Ambiguous active groups are paused in full; never choose a winning condition set on upgrade.
CREATE TEMP TABLE ambiguous_runbook_trigger_groups ON COMMIT DROP AS
SELECT "bindingId", event, jsonb_agg(jsonb_build_object('id', id, 'enabled', enabled) ORDER BY id) AS triggers
FROM "RunbookTrigger" WHERE enabled GROUP BY "bindingId", event HAVING count(*) > 1;

INSERT INTO "AuditLog" (id, action, "entityType", "entityId", details, "createdAt")
SELECT 'trigger-invariant:' || groups."bindingId" || ':' || groups.event::text,
  'runbook.trigger.ambiguity.paused', 'RUNBOOK', rule."runbookId",
  jsonb_build_object('contractVersion', 1, 'source', 'SYSTEM', 'metadata',
    jsonb_build_object('migration', '20261018140000_runbook_active_trigger_invariant',
      'bindingId', groups."bindingId", 'event', groups.event, 'previousTriggers', groups.triggers)),
  CURRENT_TIMESTAMP
FROM ambiguous_runbook_trigger_groups groups JOIN "ServiceRunbookBinding" rule ON rule.id = groups."bindingId";
UPDATE "ServiceRunbookBinding" SET enabled = false
WHERE id IN (SELECT "bindingId" FROM ambiguous_runbook_trigger_groups);
UPDATE "RunbookTrigger" trigger SET enabled = false
FROM ambiguous_runbook_trigger_groups groups
WHERE trigger."bindingId" = groups."bindingId" AND trigger.event = groups.event AND trigger.enabled;

CREATE UNIQUE INDEX "RunbookTrigger_one_enabled_event_per_binding"
ON "RunbookTrigger" ("bindingId", event) WHERE enabled;
