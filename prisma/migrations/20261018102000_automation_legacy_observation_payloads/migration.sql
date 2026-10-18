-- Older queued samples have no keyed identity. Drop diagnostic values while
-- preserving candidate aggregates and durable worker execution metadata.
UPDATE "BackgroundJob" SET payload = jsonb_set(payload, '{observations}', '[]'::jsonb)
WHERE type = 'SCHEDULED_TASK'::"JobType" AND payload->>'task' = 'AUTOMATION_OBSERVE';
