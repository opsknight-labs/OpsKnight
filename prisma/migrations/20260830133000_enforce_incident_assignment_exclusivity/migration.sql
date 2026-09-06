-- Repair legacy dual assignments deterministically before enforcing the
-- domain invariant. A direct user assignee takes precedence over a team.
UPDATE "Incident"
SET "teamId" = NULL
WHERE "assigneeId" IS NOT NULL
  AND "teamId" IS NOT NULL;

ALTER TABLE "Incident"
ADD CONSTRAINT "Incident_assignment_exclusive"
CHECK ("assigneeId" IS NULL OR "teamId" IS NULL);
