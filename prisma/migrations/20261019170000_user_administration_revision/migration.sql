-- Every writer, including SCIM, OIDC and older application versions, invalidates the validator.
ALTER TABLE "User" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION public.opsknight_user_administration_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "User_administration_revision" BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION public.opsknight_user_administration_revision();
