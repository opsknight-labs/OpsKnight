ALTER TABLE "NotificationProvider"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- All provider writers, including legacy settings and privacy maintenance paths,
-- advance a database-owned strong validator.
CREATE FUNCTION public.opsknight_notification_provider_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "NotificationProvider_revision"
BEFORE UPDATE ON "NotificationProvider"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_notification_provider_revision();
