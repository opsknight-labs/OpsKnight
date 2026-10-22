BEGIN;
-- The active-pool assignment guard takes FOR SHARE. Concurrent inserts used
-- to retain that shared lock and then both upgrade it in the AFTER revision
-- trigger, forming a shared-lock/update cycle. Acquire the required update
-- strength first, including for direct SQL and old application writers.
CREATE FUNCTION public.opsknight_runbook_membership_parent_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE old_pool TEXT; new_pool TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_pool := OLD."poolId"; END IF;
  IF TG_OP <> 'DELETE' THEN new_pool := NEW."poolId"; END IF;
  -- Moving a membership affects both parent revisions. Lock parents in the
  -- same order before either retirement checks or revision updates.
  PERFORM id FROM public."RunbookAgentPool"
    WHERE id IN (old_pool, new_pool) ORDER BY id FOR NO KEY UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
-- PostgreSQL fires same-kind triggers alphabetically: 00 precedes active_pool.
CREATE TRIGGER "RunbookAgentPoolMember_00_parent_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "RunbookAgentPoolMember"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_runbook_membership_parent_lock();
COMMIT;
