-- Replace only the detach function; rebind its installation-schema search path.
BEGIN;
CREATE OR REPLACE FUNCTION opsknight_ingestion_ordering_detach(receipt_id TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  membership "IngestionOrderingLink"%ROWTYPE;
  successor "IngestionOrderingLink"%ROWTYPE;
  identities TEXT[];
  successor_wait_count INTEGER;
  successor_keys TEXT[];
  successor_service_id TEXT;
  successor_critical BOOLEAN;
  successor_status TEXT;
BEGIN
  SELECT array_agg("identity") INTO identities FROM "IngestionOrderingLink"
    WHERE "receiptId" = receipt_id;
  IF identities IS NULL THEN RETURN; END IF;
  PERFORM opsknight_ingestion_ordering_lock(identities);
  -- Common independent-event case: every identity belongs only to this receipt.
  -- The sorted advisory locks above exclude append/repair while checking and
  -- deleting derived rows. No successor exists, so no dependency can advance.
  -- Use one indexed membership check and two set-based deletes instead of
  -- repeating head/tail rewrites and empty-head deletes for each alias.
  IF NOT EXISTS (
    SELECT 1 FROM "IngestionOrderingLink" link
    LEFT JOIN "IngestionOrderingHead" head ON head."identity" = link."identity"
    WHERE link."receiptId" = receipt_id
      AND (head."headId" IS DISTINCT FROM receipt_id
        OR head."tailId" IS DISTINCT FROM receipt_id)
  ) THEN
    DELETE FROM "IngestionOrderingLink" WHERE "receiptId" = receipt_id;
    DELETE FROM "IngestionOrderingHead" WHERE "headId" = receipt_id AND "tailId" = receipt_id;
    RETURN;
  END IF;
  FOR membership IN SELECT * FROM "IngestionOrderingLink"
    WHERE "receiptId" = receipt_id ORDER BY "identity" COLLATE "C"
  LOOP
    successor_wait_count := NULL;
    successor_keys := NULL;
    successor_service_id := NULL;
    successor_critical := NULL;
    successor_status := NULL;
    SELECT * INTO successor FROM "IngestionOrderingLink"
      WHERE "identity" = membership."identity" AND "predecessorId" = receipt_id;
    DELETE FROM "IngestionOrderingLink"
      WHERE "identity" = membership."identity" AND "receiptId" = receipt_id;
    IF successor."receiptId" IS NOT NULL THEN
      UPDATE "IngestionOrderingLink" SET "predecessorId" = membership."predecessorId"
        WHERE "identity" = membership."identity" AND "receiptId" = successor."receiptId";
      IF membership."predecessorId" IS NULL THEN
        UPDATE "IngestionReceipt" SET "orderingWaitCount" = "orderingWaitCount" - 1
          WHERE "id" = successor."receiptId"
          RETURNING "orderingWaitCount", "orderingKeys", "serviceId", "critical", "status"
          INTO successor_wait_count, successor_keys, successor_service_id, successor_critical, successor_status;
      END IF;
    END IF;
    UPDATE "IngestionOrderingHead" SET
      "headId" = CASE WHEN "headId" = receipt_id THEN successor."receiptId" ELSE "headId" END,
      "headSequence" = CASE WHEN "headId" = receipt_id THEN successor."sequence" ELSE "headSequence" END,
      "headCritical" = CASE WHEN "headId" = receipt_id
        THEN COALESCE(successor_critical, false) ELSE "headCritical" END,
      "headPrimary" = CASE WHEN "headId" = receipt_id THEN COALESCE(membership."identity" =
        COALESCE(successor_keys[array_lower(successor_keys, 1)],
          'unidentified:' || successor_service_id), false) ELSE "headPrimary" END,
      "headReady" = CASE WHEN "headId" = receipt_id
        THEN COALESCE(successor_wait_count = 0, false) ELSE "headReady" END,
      "headActive" = CASE WHEN "headId" = receipt_id
        THEN COALESCE(successor_status IN ('PENDING', 'PROCESSING'), false) ELSE "headActive" END,
      "tailId" = CASE WHEN "tailId" = receipt_id THEN membership."predecessorId" ELSE "tailId" END,
      "tailSequence" = CASE WHEN "tailId" = receipt_id THEN (
        SELECT "sequence" FROM "IngestionOrderingLink" WHERE "identity" = membership."identity"
          AND "receiptId" = membership."predecessorId"
      ) ELSE "tailSequence" END
      WHERE "identity" = membership."identity";
    IF successor."receiptId" IS NOT NULL AND membership."predecessorId" IS NULL THEN
      UPDATE "IngestionOrderingHead" SET "headReady" = (successor_wait_count = 0)
        WHERE "headId" = successor."receiptId"
          AND "headReady" IS DISTINCT FROM (successor_wait_count = 0);
    END IF;
    DELETE FROM "IngestionOrderingHead" WHERE "identity" = membership."identity"
      AND "headId" IS NULL AND "tailId" IS NULL;
  END LOOP;
END;
$$;

DO $$ DECLARE target_schema TEXT := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.opsknight_ingestion_ordering_detach(text) SET search_path = pg_catalog, %I, pg_temp',
    target_schema, target_schema);
END $$;
COMMIT;
