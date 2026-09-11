-- Rolling-compatible repair for 20260910174500_guard_jira_mapping_workspace.
--
-- The earlier migration rejected deployment when historical data already
-- contained multiple Jira links for one action item. That is a valid data
-- quality problem, but it must not make an otherwise healthy application
-- unavailable during a rolling deploy.
--
-- This migration follows expand/migrate/contract semantics:
--   1. Re-establish the workspace fences idempotently, regardless of how far
--      the failed migration progressed.
--   2. Preserve all historical Jira associations for operator review.
--   3. Prevent every NEW duplicate action-item Jira association at the database
--      boundary, including writes from older application instances.
--   4. Allow metadata-only updates to existing legacy duplicate rows so normal
--      Jira synchronization remains available during cleanup.
--
-- Once historical duplicates are reconciled, a later contract migration may
-- add the partial unique index. Startup must never require that cleanup.

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

-- Preserve legacy duplicates but serialize ownership-changing writes for each
-- action item. A 64-bit seeded PostgreSQL hash keeps the lock local to one
-- action item while making accidental lock collisions vanishingly unlikely.
CREATE OR REPLACE FUNCTION "guard_jira_action_item_single_link"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."provider" <> 'JIRA' OR NEW."actionItemId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Existing duplicate rows must remain synchronizable. The UPDATE trigger is
  -- scoped to provider/actionItemId columns, but keep this identity check as a
  -- defense if the trigger definition is broadened in the future. Keep OLD
  -- inside the UPDATE-only branch because OLD is not assigned for INSERT.
  IF TG_OP = 'UPDATE' THEN
    IF OLD."provider" = NEW."provider"
      AND OLD."actionItemId" IS NOT DISTINCT FROM NEW."actionItemId"
    THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW."actionItemId", 9141006::bigint)
  );

  IF EXISTS (
    SELECT 1
    FROM "ExternalIssueLink"
    WHERE "provider" = 'JIRA'
      AND "actionItemId" = NEW."actionItemId"
      AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'Action item already has a Jira issue link'
      USING ERRCODE = '23505',
            CONSTRAINT = 'ExternalIssueLink_jira_actionItemId_guard';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_guard_jira_action_item_single_link_insert" ON "ExternalIssueLink";
DROP TRIGGER IF EXISTS "trg_guard_jira_action_item_single_link_ownership_update" ON "ExternalIssueLink";

CREATE TRIGGER "trg_guard_jira_action_item_single_link_insert"
BEFORE INSERT ON "ExternalIssueLink"
FOR EACH ROW
EXECUTE FUNCTION "guard_jira_action_item_single_link"();

CREATE TRIGGER "trg_guard_jira_action_item_single_link_ownership_update"
BEFORE UPDATE OF "provider", "actionItemId" ON "ExternalIssueLink"
FOR EACH ROW
EXECUTE FUNCTION "guard_jira_action_item_single_link"();
