ALTER TABLE "OidcConfig" ADD COLUMN "tokenEndpointAuthMethod" TEXT DEFAULT 'client_secret_basic';

-- Canonicalize legacy issuer strings with trailing slashes
UPDATE "OidcConfig"
SET "issuer" = rtrim("issuer", '/')
WHERE "issuer" LIKE '%/';

-- Deduplicate any legacy trailing-slash OidcIdentity rows that would collide with canonical rows
DELETE FROM "OidcIdentity" o1
WHERE o1."issuer" LIKE '%/'
  AND EXISTS (
    SELECT 1 FROM "OidcIdentity" o2
    WHERE o2."issuer" = rtrim(o1."issuer", '/')
      AND o2."subject" = o1."subject"
  );

UPDATE "OidcIdentity"
SET "issuer" = rtrim("issuer", '/')
WHERE "issuer" LIKE '%/';
