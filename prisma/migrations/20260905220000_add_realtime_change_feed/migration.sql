CREATE TABLE "RealtimeChange" (
  "id" BIGSERIAL NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RealtimeChange_pkey" PRIMARY KEY ("id")
);

INSERT INTO "RealtimeChange" ("changedAt") VALUES (CURRENT_TIMESTAMP);

CREATE FUNCTION "opsknight_append_realtime_change"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  change_id BIGINT;
BEGIN
  INSERT INTO public."RealtimeChange" ("changedAt")
  VALUES (CURRENT_TIMESTAMP)
  RETURNING "id" INTO change_id;

  -- This is a level-triggered change signal, not an event audit log. Keep a
  -- bounded tail without placing every mutation behind one hot singleton row.
  IF change_id % 1000 = 0 THEN
    DELETE FROM public."RealtimeChange"
    WHERE "id" < change_id - 10000;
  END IF;
  RETURN NULL;
END;
$$;

-- Statement-level triggers append once per mutation statement, not
-- once per affected row. Trigger work participates in the caller transaction,
-- so subscribers can never observe an uncommitted projection generation.
CREATE TRIGGER "Incident_realtime_change"
AFTER INSERT OR UPDATE OR DELETE ON "Incident"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();

CREATE TRIGGER "Service_realtime_change"
AFTER INSERT OR UPDATE OR DELETE ON "Service"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();
