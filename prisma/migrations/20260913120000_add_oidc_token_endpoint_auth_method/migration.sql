ALTER TABLE "OidcConfig" ADD COLUMN "tokenEndpointAuthMethod" TEXT DEFAULT 'client_secret_basic';

-- Canonicalize legacy issuer strings across semantic URL equivalents
-- (trailing slashes, explicit default HTTPS port 443, uppercase hostnames)
UPDATE "OidcConfig"
SET "issuer" = REGEXP_REPLACE(LOWER(rtrim("issuer", '/')), '^(https://[^/:]+):443($|/)', '\1\2')
WHERE "issuer" LIKE '%/' OR "issuer" ~* ':443($|/)' OR "issuer" ~ '[A-Z]';

-- Reconcile legacy OidcIdentity records safely across all semantic URL equivalents:
-- 1. If two rows exist with the same canonical issuer and subject but DIFFERENT userId,
--    abort the migration with an exception to prevent silent account hijacking or data loss.
-- 2. Only deduplicate identical mappings belonging to the SAME user.
-- 3. Canonicalize all remaining legacy issuer records to standard lowercase, no-443, no-trailing-slash.
DO $$
DECLARE
  conflict_count INT;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM "OidcIdentity" o1
  JOIN "OidcIdentity" o2
    ON REGEXP_REPLACE(LOWER(rtrim(o1."issuer", '/')), '^(https://[^/:]+):443($|/)', '\1\2') =
       REGEXP_REPLACE(LOWER(rtrim(o2."issuer", '/')), '^(https://[^/:]+):443($|/)', '\1\2')
   AND o1."subject" = o2."subject"
   AND o1."userId" <> o2."userId"
   AND o1."id" < o2."id";

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration: found % conflicting OidcIdentity records with the same canonical issuer and subject but different userId values. Resolve identity ownership manually before migrating.', conflict_count;
  END IF;

  -- Deduplicate same-user legacy records across all equivalent issuer variants
  -- (e.g. https://idp.example.com, https://idp.example.com/, https://IDP.EXAMPLE.COM:443/)
  DELETE FROM "OidcIdentity"
  WHERE "id" IN (
    SELECT "id"
    FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY REGEXP_REPLACE(LOWER(rtrim("issuer", '/')), '^(https://[^/:]+):443($|/)', '\1\2'), "subject", "userId"
               ORDER BY
                 -- Keep exact canonical form if present, else oldest record
                 CASE WHEN "issuer" NOT LIKE '%/' AND "issuer" NOT LIKE '%:443%' THEN 0 ELSE 1 END ASC,
                 "createdAt" ASC,
                 "id" ASC
             ) AS rn
      FROM "OidcIdentity"
    ) ranked
    WHERE ranked.rn > 1
  );

  UPDATE "OidcIdentity"
  SET "issuer" = REGEXP_REPLACE(LOWER(rtrim("issuer", '/')), '^(https://[^/:]+):443($|/)', '\1\2')
  WHERE "issuer" LIKE '%/' OR "issuer" ~* ':443($|/)' OR "issuer" ~ '[A-Z]';
END $$;
