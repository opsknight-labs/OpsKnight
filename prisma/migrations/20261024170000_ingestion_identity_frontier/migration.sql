-- Maintenance-window migration: initialize the entire unfinished frontier before
-- any new reader can use its counters. Triggers also support older image writes.
BEGIN;
ALTER TABLE "IngestionReceipt" ADD COLUMN "orderingWaitCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IngestionReceipt" ADD CONSTRAINT "IngestionReceipt_ordering_wait_nonnegative"
  CHECK ("orderingWaitCount" >= 0);

CREATE TABLE "IngestionOrderingHead" (
  "identity" TEXT PRIMARY KEY,
  "headId" TEXT,
  "headSequence" BIGINT,
  "headCritical" BOOLEAN NOT NULL DEFAULT false,
  "headPrimary" BOOLEAN NOT NULL DEFAULT false,
  "headReady" BOOLEAN NOT NULL DEFAULT false,
  "headActive" BOOLEAN NOT NULL DEFAULT false,
  "tailId" TEXT,
  "tailSequence" BIGINT,
  CHECK (("headId" IS NULL) = ("headSequence" IS NULL)),
  CHECK (("tailId" IS NULL) = ("tailSequence" IS NULL)),
  CHECK (("headId" IS NULL) = ("tailId" IS NULL)),
  CHECK ("headSequence" <= "tailSequence"),
  CHECK (NOT ("headReady" OR "headPrimary" OR "headActive") OR "headId" IS NOT NULL)
);
CREATE INDEX "IngestionOrderingHead_headId_idx" ON "IngestionOrderingHead"("headId");
CREATE UNIQUE INDEX "IngestionOrderingHead_primary_receipt_idx" ON "IngestionOrderingHead"("headId")
  WHERE "headPrimary";
CREATE TABLE "IngestionOrderingLink" (
  "identity" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL REFERENCES "IngestionReceipt"("id") ON DELETE CASCADE,
  "sequence" BIGINT NOT NULL,
  "predecessorId" TEXT,
  CONSTRAINT "IngestionOrderingLink_pkey" PRIMARY KEY ("identity", "receiptId"),
  CONSTRAINT "IngestionOrderingLink_identity_sequence_key" UNIQUE ("identity", "sequence"),
  CONSTRAINT "IngestionOrderingLink_identity_predecessorId_key" UNIQUE ("identity", "predecessorId"),
  CHECK ("predecessorId" IS NULL OR "predecessorId" <> "receiptId")
);
CREATE INDEX "IngestionOrderingLink_receiptId_idx" ON "IngestionOrderingLink"("receiptId");

-- Match acquireTextAdvisoryLocks: existing application admission acquires this
-- sorted union before sequence allocation. Completion uses the same namespace
-- before touching heads, preventing cross-group head-row lock inversions.
CREATE FUNCTION opsknight_ingestion_ordering_lock(identities TEXT[]) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE ordering_identity TEXT;
BEGIN
  FOR ordering_identity IN
    SELECT DISTINCT value COLLATE "C" FROM unnest(identities) AS items(value)
    ORDER BY value COLLATE "C"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('ingestion:' || ordering_identity, 0));
  END LOOP;
END;
$$;

-- Ancestor pointers are a derived index, deliberately without foreign keys:
-- key-share checks against an older worker's FOR UPDATE receipt lock can
-- deadlock admission with completion's identity lock. Only membership ownership
-- has a foreign key. AFTER INSERT handles only rows actually inserted, retaining
-- ordinary ON CONFLICT behavior. Ready unique-key inserts need no counter rewrite.
CREATE FUNCTION opsknight_ingestion_ordering_attach_values(
  receipt_id TEXT, receipt_sequence BIGINT, service_id TEXT, ordering_keys TEXT[], receipt_critical BOOLEAN
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  queue "IngestionOrderingHead"%ROWTYPE;
  ordering_identity TEXT;
  identities TEXT[];
  previous_id TEXT;
  successor_id TEXT;
  wait_count INTEGER;
  primary_identity TEXT;
BEGIN
  identities := CASE WHEN cardinality(ordering_keys) = 0
    THEN ARRAY['unidentified:' || service_id] ELSE ordering_keys END;
  primary_identity := identities[array_lower(identities, 1)];
  PERFORM opsknight_ingestion_ordering_lock(identities);
  FOR ordering_identity IN
    SELECT DISTINCT value COLLATE "C" FROM unnest(identities) AS items(value)
    ORDER BY value COLLATE "C"
  LOOP
    IF EXISTS (SELECT 1 FROM "IngestionOrderingLink"
      WHERE "identity" = ordering_identity AND "receiptId" = receipt_id) THEN CONTINUE; END IF;
    INSERT INTO "IngestionOrderingHead" ("identity") VALUES (ordering_identity)
      ON CONFLICT ("identity") DO UPDATE SET "identity" = excluded."identity"
      RETURNING * INTO queue;
    previous_id := NULL;
    successor_id := NULL;
    IF queue."tailSequence" IS NULL OR receipt_sequence > queue."tailSequence" THEN
      previous_id := queue."tailId";
    ELSE
      -- Identity repair/backfill can insert an older sequence. Splice it into
      -- the indexed active chain instead of appending behind newer receipts.
      SELECT "receiptId" INTO previous_id FROM "IngestionOrderingLink"
        WHERE "identity" = ordering_identity AND "sequence" < receipt_sequence
        ORDER BY "sequence" DESC LIMIT 1;
      SELECT "receiptId" INTO successor_id FROM "IngestionOrderingLink"
        WHERE "identity" = ordering_identity AND "sequence" > receipt_sequence
        ORDER BY "sequence" LIMIT 1;
    END IF;
    -- Free the predecessor's unique successor slot before inserting this node.
    IF successor_id IS NOT NULL THEN
      UPDATE "IngestionOrderingLink" SET "predecessorId" = receipt_id
        WHERE "identity" = ordering_identity AND "receiptId" = successor_id;
      IF previous_id IS NULL THEN
        UPDATE "IngestionReceipt" SET "orderingWaitCount" = "orderingWaitCount" + 1
          WHERE "id" = successor_id;
        UPDATE "IngestionOrderingHead" SET "headReady" = false
          WHERE "headId" = successor_id AND "headReady";
      END IF;
    END IF;
    INSERT INTO "IngestionOrderingLink" ("identity", "receiptId", "sequence", "predecessorId")
      VALUES (ordering_identity, receipt_id, receipt_sequence, previous_id);
    UPDATE "IngestionOrderingHead" SET
      "headId" = CASE WHEN "headSequence" IS NULL OR receipt_sequence < "headSequence"
        THEN receipt_id ELSE "headId" END,
      "headSequence" = CASE WHEN "headSequence" IS NULL OR receipt_sequence < "headSequence"
        THEN receipt_sequence ELSE "headSequence" END,
      "headCritical" = CASE WHEN "headSequence" IS NULL OR receipt_sequence < "headSequence"
        THEN receipt_critical ELSE "headCritical" END,
      "headPrimary" = CASE WHEN "headSequence" IS NULL OR receipt_sequence < "headSequence"
        THEN ordering_identity = primary_identity ELSE "headPrimary" END,
      "headReady" = CASE WHEN "headSequence" IS NULL OR receipt_sequence < "headSequence"
        THEN false ELSE "headReady" END,
      "headActive" = CASE WHEN "headSequence" IS NULL OR receipt_sequence < "headSequence"
        THEN true ELSE "headActive" END,
      "tailId" = CASE WHEN "tailSequence" IS NULL OR receipt_sequence > "tailSequence"
        THEN receipt_id ELSE "tailId" END,
      "tailSequence" = CASE WHEN "tailSequence" IS NULL OR receipt_sequence > "tailSequence"
        THEN receipt_sequence ELSE "tailSequence" END
      WHERE "identity" = ordering_identity;
  END LOOP;
  SELECT count(*)::int INTO wait_count FROM "IngestionOrderingLink"
    WHERE "receiptId" = receipt_id AND "predecessorId" IS NOT NULL;
  UPDATE "IngestionOrderingHead" SET "headReady" = (wait_count = 0)
    WHERE "headId" = receipt_id AND "headReady" IS DISTINCT FROM (wait_count = 0);
  RETURN wait_count;
END;
$$;

CREATE FUNCTION opsknight_ingestion_ordering_attach(receipt_id TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE receipt RECORD; wait_count INTEGER;
BEGIN
  SELECT "sequence", "serviceId", "orderingKeys", "status", "critical", "orderingWaitCount" INTO STRICT receipt
    FROM "IngestionReceipt" WHERE "id" = receipt_id;
  IF receipt."status" IN ('COMPLETED', 'ARCHIVED') THEN RETURN; END IF;
  wait_count := opsknight_ingestion_ordering_attach_values(
    receipt_id, receipt."sequence", receipt."serviceId", receipt."orderingKeys", receipt."critical");
  IF receipt."orderingWaitCount" <> wait_count THEN
    UPDATE "IngestionReceipt" SET "orderingWaitCount" = wait_count WHERE "id" = receipt_id;
  END IF;
  UPDATE "IngestionOrderingHead" SET "headActive" = (receipt."status" IN ('PENDING', 'PROCESSING'))
    WHERE "headId" = receipt_id
      AND "headActive" IS DISTINCT FROM (receipt."status" IN ('PENDING', 'PROCESSING'));
END;
$$;

CREATE FUNCTION opsknight_ingestion_ordering_detach(receipt_id TEXT) RETURNS VOID
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

CREATE FUNCTION opsknight_ingestion_ordering_write() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE old_keys TEXT[]; new_keys TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" NOT IN ('COMPLETED', 'ARCHIVED') THEN
      PERFORM opsknight_ingestion_ordering_detach(OLD."id");
    END IF;
    RETURN OLD;
  END IF;
  new_keys := CASE WHEN cardinality(NEW."orderingKeys") = 0
    THEN ARRAY['unidentified:' || NEW."serviceId"] ELSE NEW."orderingKeys" END;
  IF TG_OP = 'INSERT' THEN
    PERFORM opsknight_ingestion_ordering_attach(NEW."id");
    RETURN NEW;
  END IF;
  IF (OLD."status" IN ('COMPLETED', 'ARCHIVED')) = (NEW."status" IN ('COMPLETED', 'ARCHIVED'))
    AND OLD."orderingKeys" IS NOT DISTINCT FROM NEW."orderingKeys" THEN
    IF (OLD."status" IN ('PENDING', 'PROCESSING')) IS DISTINCT FROM (NEW."status" IN ('PENDING', 'PROCESSING'))
      OR OLD."critical" IS DISTINCT FROM NEW."critical" THEN
      PERFORM opsknight_ingestion_ordering_lock(new_keys);
      UPDATE "IngestionOrderingHead" SET "headActive" = (NEW."status" IN ('PENDING', 'PROCESSING')),
        "headCritical" = NEW."critical" WHERE "headId" = NEW."id";
    END IF;
    RETURN NEW;
  END IF;
  old_keys := CASE WHEN cardinality(OLD."orderingKeys") = 0
    THEN ARRAY['unidentified:' || OLD."serviceId"] ELSE OLD."orderingKeys" END;
  PERFORM opsknight_ingestion_ordering_lock(old_keys || new_keys);
  PERFORM opsknight_ingestion_ordering_detach(NEW."id");
  NEW."orderingWaitCount" := 0;
  IF NEW."status" NOT IN ('COMPLETED', 'ARCHIVED') THEN
    NEW."orderingWaitCount" := opsknight_ingestion_ordering_attach_values(
      NEW."id", NEW."sequence", NEW."serviceId", NEW."orderingKeys", NEW."critical");
    UPDATE "IngestionOrderingHead" SET "headActive" = (NEW."status" IN ('PENDING', 'PROCESSING'))
      WHERE "headId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

-- Bind function lookup to the installation schema, not the caller or public.
-- pg_catalog first and pg_temp last prevent temporary-relation shadowing.
DO $$ DECLARE target_schema TEXT := current_schema(); definition RECORD;
BEGIN
  FOR definition IN SELECT p.oid FROM pg_proc p
    WHERE p.pronamespace = target_schema::regnamespace
      AND p.proname = ANY (ARRAY[
        'opsknight_ingestion_ordering_lock', 'opsknight_ingestion_ordering_attach_values',
        'opsknight_ingestion_ordering_attach', 'opsknight_ingestion_ordering_detach',
        'opsknight_ingestion_ordering_write'
      ])
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, %I, pg_temp',
      definition.oid::regprocedure, target_schema);
  END LOOP;
END $$;

DO $$ DECLARE receipt RECORD;
BEGIN
  FOR receipt IN SELECT "id" FROM "IngestionReceipt"
    WHERE "status" NOT IN ('COMPLETED', 'ARCHIVED') ORDER BY "sequence"
  LOOP PERFORM opsknight_ingestion_ordering_attach(receipt."id"); END LOOP;
END $$;

CREATE TRIGGER "IngestionReceipt_ordering_insert" AFTER INSERT ON "IngestionReceipt"
  FOR EACH ROW EXECUTE FUNCTION opsknight_ingestion_ordering_write();
CREATE TRIGGER "IngestionReceipt_ordering_update" BEFORE UPDATE OF "status", "orderingKeys", "critical" ON "IngestionReceipt"
  FOR EACH ROW EXECUTE FUNCTION opsknight_ingestion_ordering_write();
CREATE TRIGGER "IngestionReceipt_ordering_delete" BEFORE DELETE ON "IngestionReceipt"
  FOR EACH ROW EXECUTE FUNCTION opsknight_ingestion_ordering_write();
CREATE INDEX "IngestionOrderingHead_eligible_idx" ON "IngestionOrderingHead" ("headCritical", "headSequence")
  WHERE "headPrimary" AND "headReady" AND "headActive";
COMMIT;
