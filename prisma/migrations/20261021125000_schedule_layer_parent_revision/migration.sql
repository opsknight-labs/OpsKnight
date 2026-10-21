-- The schedule detail representation contains layers. Keep its ETag current
-- when either the UI or REST edits a layer (participant changes touch the layer).
CREATE FUNCTION public.opsknight_schedule_layer_parent_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "OnCallSchedule" SET "updatedAt" = clock_timestamp() WHERE "id" = OLD."scheduleId";
    RETURN OLD;
  END IF;
  UPDATE "OnCallSchedule" SET "updatedAt" = clock_timestamp() WHERE "id" = NEW."scheduleId";
  IF TG_OP = 'UPDATE' AND OLD."scheduleId" IS DISTINCT FROM NEW."scheduleId" THEN
    UPDATE "OnCallSchedule" SET "updatedAt" = clock_timestamp() WHERE "id" = OLD."scheduleId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OnCallLayer_schedule_revision"
AFTER INSERT OR UPDATE OR DELETE ON "OnCallLayer"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_schedule_layer_parent_revision();
