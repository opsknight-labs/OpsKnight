ALTER TABLE "OidcConfig" ADD COLUMN "tokenEndpointAuthMethod" TEXT DEFAULT 'client_secret_basic';

-- Canonicalize legacy issuer strings with trailing slashes
UPDATE "OidcConfig"
SET "issuer" = rtrim("issuer", '/')
WHERE "issuer" LIKE '%/';

-- Reconcile legacy trailing-slash OidcIdentity records safely:
-- 1. If two rows exist with the same canonical issuer and subject but DIFFERENT userId,
--    abort the migration with an exception to prevent silent account hijacking or data loss.
-- 2. Only deduplicate identical mappings belonging to the SAME user.
-- 3. Canonicalize all remaining legacy trailing-slash issuer records.
DO $$
DECLARE
  conflict_count INT;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM "OidcIdentity" o1
  JOIN "OidcIdentity" o2
    ON rtrim(o1."issuer", '/') = rtrim(o2."issuer", '/')
   AND o1."subject" = o2."subject"
   AND o1."userId" <> o2."userId"
   AND o1."id" < o2."id";

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration: found % conflicting OidcIdentity records with the same canonical issuer and subject but different userId values. Resolve identity ownership manually before migrating.', conflict_count;
  END IF;

  DELETE FROM "OidcIdentity" o1
  WHERE o1."issuer" LIKE '%/'
    AND EXISTS (
      SELECT 1 FROM "OidcIdentity" o2
      WHERE o2."issuer" = rtrim(o1."issuer", '/')
        AND o2."subject" = o1."subject"
        AND o2."userId" = o1."userId"
    );

  UPDATE "OidcIdentity"
  SET "issuer" = rtrim("issuer", '/')
  WHERE "issuer" LIKE '%/';
END $$;
