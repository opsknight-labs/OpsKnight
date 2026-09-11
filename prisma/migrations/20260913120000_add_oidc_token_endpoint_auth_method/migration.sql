ALTER TABLE "OidcConfig" ADD COLUMN "tokenEndpointAuthMethod" TEXT DEFAULT 'client_secret_basic';

-- Canonicalize legacy issuer strings with trailing slashes
UPDATE "OidcConfig"
SET "issuer" = rtrim("issuer", '/')
WHERE "issuer" LIKE '%/';

UPDATE "OidcIdentity"
SET "issuer" = rtrim("issuer", '/')
WHERE "issuer" LIKE '%/';
