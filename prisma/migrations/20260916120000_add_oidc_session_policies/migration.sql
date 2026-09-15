-- AlterTable
ALTER TABLE "OidcConfig" ADD COLUMN IF NOT EXISTS "sessionMaxAgeSeconds" INTEGER,
ADD COLUMN IF NOT EXISTS "sessionIdleTimeoutSeconds" INTEGER;
