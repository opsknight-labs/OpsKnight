-- Jira service mappings and Jira issue links are meaningful only while the
-- workspace integration exists and is enabled. The shared advisory lock below
-- coordinates these database writes with the application-level Jira workspace
-- lifecycle fence (LOCK_KEYS.JIRA_WORKSPACE = 9141005).
--
-- Provider work and these triggers take the lock in SHARED mode. Enable,
-- disable, credential changes, and destructive removal take it EXCLUSIVE.
-- Whichever operation is admitted first establishes the authoritative outcome.

CREATE OR REPLACE FUNCTION "guard_jira_service_mapping_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(9141005::bigint);

  PERFORM 1
  FROM "JiraConfig"
  WHERE "id" = 'default'
    AND "enabled" = TRUE
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jira workspace is not configured or is disabled'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_guard_jira_service_mapping_workspace" ON "JiraServiceMapping";

CREATE TRIGGER "trg_guard_jira_service_mapping_workspace"
BEFORE INSERT OR UPDATE ON "JiraServiceMapping"
FOR EACH ROW
EXECUTE FUNCTION "guard_jira_service_mapping_workspace"();

-- Defense in depth for every Jira link writer, including future code paths.
-- A disabled/removed workspace must never acquire or mutate active Jira link
-- state even if a stale server action or background worker reaches the DB.
CREATE OR REPLACE FUNCTION "guard_jira_external_issue_link_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."provider" = 'JIRA' THEN
    PERFORM pg_advisory_xact_lock_shared(9141005::bigint);

    PERFORM 1
    FROM "JiraConfig"
    WHERE "id" = 'default'
      AND "enabled" = TRUE
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Jira workspace is not configured or is disabled'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_guard_jira_external_issue_link_workspace" ON "ExternalIssueLink";

CREATE TRIGGER "trg_guard_jira_external_issue_link_workspace"
BEFORE INSERT OR UPDATE ON "ExternalIssueLink"
FOR EACH ROW
EXECUTE FUNCTION "guard_jira_external_issue_link_workspace"();

-- Product invariant: an action item owns at most one active Jira ticket. The
-- incident Jira ticket is inherited read-only context and is never duplicated
-- onto the action-item row, so it does not participate in this constraint.
--
-- Do not silently discard ambiguous legacy data. If an installation already
-- contains duplicate action-item Jira links, fail migration loudly so an
-- operator can review the affected tickets instead of losing associations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ExternalIssueLink"
    WHERE "provider" = 'JIRA'
      AND "actionItemId" IS NOT NULL
    GROUP BY "actionItemId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one Jira issue per action item: duplicate Jira links exist. Review and unlink duplicates before applying this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIssueLink_jira_actionItemId_unique"
ON "ExternalIssueLink" ("actionItemId")
WHERE "provider" = 'JIRA' AND "actionItemId" IS NOT NULL;
