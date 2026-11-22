-- Keep published status-page snapshots honest when business services change. Page mappings use
-- the existing page-scoped invalidation; membership and business-service edits mark every page
-- that shows the business service. None of these tables is on the incident hot path.
CREATE TRIGGER status_business_mapping_snapshot_dirty
AFTER INSERT OR UPDATE OR DELETE ON "StatusPageBusinessService"
FOR EACH ROW EXECUTE FUNCTION invalidate_status_page_snapshot();

CREATE FUNCTION invalidate_business_service_snapshots() RETURNS TRIGGER AS $$
DECLARE business_ids TEXT[];
BEGIN
  IF TG_TABLE_NAME = 'BusinessService' THEN
    IF TG_OP = 'DELETE' THEN business_ids := ARRAY[OLD."id"];
    ELSE business_ids := ARRAY[NEW."id"]; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN business_ids := ARRAY[OLD."businessServiceId"];
    ELSIF TG_OP = 'INSERT' THEN business_ids := ARRAY[NEW."businessServiceId"];
    ELSE business_ids := ARRAY[OLD."businessServiceId", NEW."businessServiceId"]; END IF;
  END IF;
  UPDATE "StatusPageSnapshot" SET "revision" = "revision" + 1
  WHERE "statusPageId" IN (
    SELECT "statusPageId" FROM "StatusPageBusinessService"
    WHERE "businessServiceId" = ANY(business_ids)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER business_service_member_snapshot_dirty
AFTER INSERT OR UPDATE OR DELETE ON "BusinessServiceMember"
FOR EACH ROW EXECUTE FUNCTION invalidate_business_service_snapshots();

CREATE TRIGGER business_service_snapshot_dirty
AFTER UPDATE OF "name", "description" ON "BusinessService"
FOR EACH ROW EXECUTE FUNCTION invalidate_business_service_snapshots();
