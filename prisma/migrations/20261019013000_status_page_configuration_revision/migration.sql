ALTER TABLE "StatusPage" ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION fence_status_page_configuration_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END;
$$;
CREATE TRIGGER status_page_configuration_revision_before_update BEFORE UPDATE ON "StatusPage"
FOR EACH ROW EXECUTE FUNCTION fence_status_page_configuration_revision();
CREATE FUNCTION touch_status_page_service_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "StatusPage" SET "updatedAt" = CURRENT_TIMESTAMP WHERE id = OLD."statusPageId";
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."statusPageId" IS DISTINCT FROM OLD."statusPageId") THEN
    UPDATE "StatusPage" SET "updatedAt" = CURRENT_TIMESTAMP WHERE id = NEW."statusPageId";
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER status_page_service_configuration_after_write AFTER INSERT OR UPDATE OR DELETE ON "StatusPageService"
FOR EACH ROW EXECUTE FUNCTION touch_status_page_service_configuration();
