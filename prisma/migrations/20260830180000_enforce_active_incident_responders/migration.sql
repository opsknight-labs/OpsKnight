-- Repair existing invalid incident responder references before enforcing the
-- invariant for future writes. Historical timeline/audit rows remain intact.
UPDATE "Incident" AS incident
SET "assigneeId" = NULL
WHERE incident."assigneeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "User" AS responder
    WHERE responder."id" = incident."assigneeId"
      AND responder."status"::text = 'ACTIVE'
  );

DELETE FROM "IncidentWatcher" AS watcher
WHERE NOT EXISTS (
  SELECT 1
  FROM "User" AS responder
  WHERE responder."id" = watcher."userId"
    AND responder."status"::text = 'ACTIVE'
);

UPDATE "IncidentWatcher"
SET "role" = 'FOLLOWER'
WHERE "role" NOT IN ('FOLLOWER', 'STAKEHOLDER', 'EXEC');

ALTER TABLE "IncidentWatcher"
ADD CONSTRAINT "IncidentWatcher_role_valid"
CHECK ("role" IN ('FOLLOWER', 'STAKEHOLDER', 'EXEC'));

CREATE OR REPLACE FUNCTION "opsknight_require_active_incident_assignee"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."assigneeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "User" AS responder
    WHERE responder."id" = NEW."assigneeId"
      AND responder."status"::text = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'incident assignee must reference an ACTIVE user'
      USING ERRCODE = '23514',
            CONSTRAINT = 'Incident_assignee_active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Incident_require_active_assignee" ON "Incident";
CREATE TRIGGER "Incident_require_active_assignee"
BEFORE INSERT OR UPDATE OF "assigneeId" ON "Incident"
FOR EACH ROW
EXECUTE FUNCTION "opsknight_require_active_incident_assignee"();

CREATE OR REPLACE FUNCTION "opsknight_require_active_incident_watcher"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "User" AS responder
    WHERE responder."id" = NEW."userId"
      AND responder."status"::text = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'incident watcher must reference an ACTIVE user'
      USING ERRCODE = '23514',
            CONSTRAINT = 'IncidentWatcher_user_active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "IncidentWatcher_require_active_user" ON "IncidentWatcher";
CREATE TRIGGER "IncidentWatcher_require_active_user"
BEFORE INSERT OR UPDATE OF "userId" ON "IncidentWatcher"
FOR EACH ROW
EXECUTE FUNCTION "opsknight_require_active_incident_watcher"();