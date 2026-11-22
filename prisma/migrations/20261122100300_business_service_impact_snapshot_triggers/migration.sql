-- Keep published status-page snapshots honest for business-service nesting and impact history.
-- Nested health rolls up to parents (depth <= 3), so every changed business service also dirties
-- the pages of its ancestors. None of these tables is on the incident hot path.
CREATE OR REPLACE FUNCTION invalidate_business_service_snapshots() RETURNS TRIGGER AS $$
DECLARE business_ids TEXT[];
BEGIN
  IF TG_TABLE_NAME = 'BusinessService' THEN
    IF TG_OP = 'DELETE' THEN business_ids := ARRAY[OLD."id"];
    ELSE business_ids := ARRAY[NEW."id"]; END IF;
  ELSIF TG_TABLE_NAME = 'BusinessServiceSupport' THEN
    IF TG_OP = 'DELETE' THEN business_ids := ARRAY[OLD."parentId", OLD."childId"];
    ELSIF TG_OP = 'INSERT' THEN business_ids := ARRAY[NEW."parentId", NEW."childId"];
    ELSE business_ids := ARRAY[OLD."parentId", OLD."childId", NEW."parentId", NEW."childId"]; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN business_ids := ARRAY[OLD."businessServiceId"];
    ELSIF TG_OP = 'INSERT' THEN business_ids := ARRAY[NEW."businessServiceId"];
    ELSE business_ids := ARRAY[OLD."businessServiceId", NEW."businessServiceId"]; END IF;
  END IF;
  WITH RECURSIVE affected(id, depth) AS (
    SELECT unnest(business_ids), 0
    UNION
    SELECT support."parentId", affected.depth + 1
    FROM "BusinessServiceSupport" support
    JOIN affected ON support."childId" = affected.id
    WHERE affected.depth < 3
  )
  UPDATE "StatusPageSnapshot" SET "revision" = "revision" + 1
  WHERE "statusPageId" IN (
    SELECT "statusPageId" FROM "StatusPageBusinessService"
    WHERE "businessServiceId" IN (SELECT id FROM affected)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER business_service_support_snapshot_dirty
AFTER INSERT OR UPDATE OR DELETE ON "BusinessServiceSupport"
FOR EACH ROW EXECUTE FUNCTION invalidate_business_service_snapshots();

CREATE TRIGGER business_service_impact_snapshot_dirty
AFTER INSERT OR UPDATE OR DELETE ON "IncidentBusinessServiceImpact"
FOR EACH ROW EXECUTE FUNCTION invalidate_business_service_snapshots();

-- The status-page summary is published text; criticality changes thresholds.
DROP TRIGGER IF EXISTS business_service_snapshot_dirty ON "BusinessService";
CREATE TRIGGER business_service_snapshot_dirty
AFTER UPDATE OF "name", "description", "statusPageSummary", "criticality", "impactMinUrgency", "impactMaxPriority" ON "BusinessService"
FOR EACH ROW EXECUTE FUNCTION invalidate_business_service_snapshots();
