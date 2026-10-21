BEGIN;
-- A write under the shared fleet advisory-lock protocol invalidates stale
-- SERIALIZABLE snapshots after waiting for committed grants/membership changes.
CREATE TABLE "RunbookFleetAuthority" (
 id TEXT NOT NULL DEFAULT 'default' PRIMARY KEY,
 revision BIGINT NOT NULL DEFAULT 0,
 CONSTRAINT "RunbookFleetAuthority_singleton" CHECK (id = 'default')
);
INSERT INTO "RunbookFleetAuthority" (id) VALUES ('default');
COMMIT;
