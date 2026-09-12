-- Canonicalize legacy issuer authority (lowercase scheme and host, strip standard HTTPS port 443)
-- while strictly preserving URL path casing.

CREATE OR REPLACE FUNCTION canonicalize_issuer_authority(raw_issuer text)
RETURNS text AS $$
DECLARE
  trimmed text;
  scheme text;
  after_scheme text;
  authority text;
  path_part text;
  canon_authority text;
BEGIN
  IF raw_issuer IS NULL THEN
    RETURN NULL;
  END IF;

  trimmed := rtrim(raw_issuer, '/');

  -- Extract scheme (e.g. https://)
  IF trimmed ~* '^https?://' THEN
    scheme := LOWER(SUBSTRING(trimmed FROM '^(?i)(https?://)'));
    after_scheme := SUBSTRING(trimmed FROM '^(?i)[a-zA-Z0-9]+://(.*)$');
  ELSE
    RETURN trimmed;
  END IF;

  -- Separate authority from path
  IF position('/' IN after_scheme) > 0 THEN
    authority := SUBSTRING(after_scheme FROM '^([^/]+)');
    path_part := SUBSTRING(after_scheme FROM position('/' IN after_scheme));
  ELSE
    authority := after_scheme;
    path_part := '';
  END IF;

  -- Authority: lowercase hostname and strip default port 443 for HTTPS (or 80 for HTTP)
  canon_authority := LOWER(authority);
  IF scheme = 'https://' AND canon_authority ~ ':443$' THEN
    canon_authority := SUBSTRING(canon_authority FROM '^(.+):443$');
  ELSIF scheme = 'http://' AND canon_authority ~ ':80$' THEN
    canon_authority := SUBSTRING(canon_authority FROM '^(.+):80$');
  END IF;

  RETURN scheme || canon_authority || path_part;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 1. Check for cross-user conflicts where two identities would canonicalize to the same issuer+subject under different users
DO $$
DECLARE
  conflict_count INT;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM "OidcIdentity" o1
  JOIN "OidcIdentity" o2
    ON canonicalize_issuer_authority(o1."issuer") = canonicalize_issuer_authority(o2."issuer")
   AND o1."subject" = o2."subject"
   AND o1."userId" <> o2."userId"
   AND o1."id" < o2."id";

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration: found % conflicting OidcIdentity records with the same canonical issuer authority and subject but different userId values. Resolve identity ownership manually before migrating.', conflict_count;
  END IF;

  -- 2. Deduplicate same-user records across authority variants
  DELETE FROM "OidcIdentity"
  WHERE "id" IN (
    SELECT "id"
    FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY canonicalize_issuer_authority("issuer"), "subject", "userId"
               ORDER BY
                 -- Keep exact canonical form if present, else oldest record
                 CASE WHEN "issuer" = canonicalize_issuer_authority("issuer") THEN 0 ELSE 1 END ASC,
                 "createdAt" ASC,
                 "id" ASC
             ) AS rn
      FROM "OidcIdentity"
    ) ranked
    WHERE ranked.rn > 1
  );

  -- 3. Update OidcIdentity records to canonical form where authority changed
  UPDATE "OidcIdentity"
  SET "issuer" = canonicalize_issuer_authority("issuer")
  WHERE "issuer" <> canonicalize_issuer_authority("issuer");

  -- 4. Update OidcConfig to canonical form
  UPDATE "OidcConfig"
  SET "issuer" = canonicalize_issuer_authority("issuer")
  WHERE "issuer" IS NOT NULL AND "issuer" <> canonicalize_issuer_authority("issuer");
END $$;

-- Drop temporary function
DROP FUNCTION canonicalize_issuer_authority(text);

-- Add issuerFingerprint to OidcIdentity to scope established identity to current client trust context
ALTER TABLE "OidcIdentity" ADD COLUMN "issuerFingerprint" TEXT;
CREATE INDEX "OidcIdentity_issuerFingerprint_idx" ON "OidcIdentity"("issuerFingerprint");

