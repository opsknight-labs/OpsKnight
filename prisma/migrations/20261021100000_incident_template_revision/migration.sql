ALTER TABLE "IncidentTemplate" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE FUNCTION public.opsknight_incident_template_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "IncidentTemplate_revision" BEFORE UPDATE ON "IncidentTemplate"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_incident_template_revision();
