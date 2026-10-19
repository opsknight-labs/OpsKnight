BEGIN;
ALTER TABLE "RunbookAgentPool" ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'ACTIVE', ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "RunbookAgentPool" ADD CONSTRAINT "RunbookAgentPool_lifecycle_check"
 CHECK ((lifecycle = 'ACTIVE' AND "retiredAt" IS NULL) OR (lifecycle = 'RETIRED' AND "retiredAt" IS NOT NULL));
CREATE FUNCTION public.opsknight_pool_retirement_terminal() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF OLD.lifecycle = 'RETIRED' AND NEW.lifecycle <> 'RETIRED' THEN
  RAISE EXCEPTION 'Retired Agent pools cannot be reactivated' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "RunbookAgentPool_retirement_terminal" BEFORE UPDATE ON "RunbookAgentPool"
 FOR EACH ROW EXECUTE FUNCTION public.opsknight_pool_retirement_terminal();
-- Parent row locks serialize assignment by old and new application versions against retirement.
CREATE FUNCTION public.opsknight_active_pool_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE pool_id TEXT; pool_state TEXT;
BEGIN
 pool_id := to_jsonb(NEW)->>TG_ARGV[0];
 IF pool_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF pool_id IS NOT DISTINCT FROM (to_jsonb(OLD)->>TG_ARGV[0]) THEN
   IF TG_TABLE_NAME <> 'ServiceRunbookBinding' OR NOT COALESCE((to_jsonb(NEW)->>'enabled')::boolean, false)
      OR COALESCE((to_jsonb(OLD)->>'enabled')::boolean, false) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 SELECT lifecycle INTO pool_state FROM public."RunbookAgentPool" WHERE id = pool_id FOR SHARE;
 IF pool_state = 'RETIRED' THEN
  RAISE EXCEPTION 'Retired Agent pools cannot receive new assignments' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "RunbookAgentPoolMember_active_pool" BEFORE INSERT OR UPDATE ON "RunbookAgentPoolMember"
 FOR EACH ROW EXECUTE FUNCTION public.opsknight_active_pool_assignment('poolId');
CREATE TRIGGER "RunbookSecretGrant_active_pool" BEFORE INSERT OR UPDATE ON "RunbookSecretGrant"
 FOR EACH ROW EXECUTE FUNCTION public.opsknight_active_pool_assignment('agentPoolId');
CREATE TRIGGER "ServiceRunbookBinding_active_pool" BEFORE INSERT OR UPDATE ON "ServiceRunbookBinding"
 FOR EACH ROW EXECUTE FUNCTION public.opsknight_active_pool_assignment('defaultAgentPoolId');
CREATE TRIGGER "RunbookExecution_active_pool" BEFORE INSERT OR UPDATE ON "RunbookExecution"
 FOR EACH ROW EXECUTE FUNCTION public.opsknight_active_pool_assignment('resolvedTargetAgentPoolId');
CREATE TRIGGER "RunbookStepAttempt_active_pool" BEFORE INSERT OR UPDATE ON "RunbookStepAttempt"
 FOR EACH ROW EXECUTE FUNCTION public.opsknight_active_pool_assignment('targetAgentPoolId');

COMMIT;
