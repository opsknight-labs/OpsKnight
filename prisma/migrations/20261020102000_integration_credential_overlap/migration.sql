ALTER TABLE "Integration"
  ADD COLUMN "previousSignatureSecret" TEXT,
  ADD COLUMN "previousSignatureSecretExpiresAt" TIMESTAMP(3);

CREATE FUNCTION public.opsknight_integration_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Integration_revision"
BEFORE UPDATE ON "Integration"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_integration_revision();
