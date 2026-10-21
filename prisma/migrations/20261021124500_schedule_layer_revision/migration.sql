ALTER TABLE "OnCallLayer" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE FUNCTION public.opsknight_schedule_layer_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OnCallLayer_revision" BEFORE UPDATE ON "OnCallLayer"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_schedule_layer_revision();

-- Participant edits change the visible layer representation, including its ETag.
CREATE FUNCTION public.opsknight_schedule_layer_participants_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "OnCallLayer" SET "updatedAt" = clock_timestamp() WHERE "id" = OLD."layerId";
    RETURN OLD;
  END IF;
  UPDATE "OnCallLayer" SET "updatedAt" = clock_timestamp() WHERE "id" = NEW."layerId";
  IF TG_OP = 'UPDATE' AND OLD."layerId" IS DISTINCT FROM NEW."layerId" THEN
    UPDATE "OnCallLayer" SET "updatedAt" = clock_timestamp() WHERE "id" = OLD."layerId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OnCallLayerUser_revision"
AFTER INSERT OR UPDATE OR DELETE ON "OnCallLayerUser"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_schedule_layer_participants_revision();
