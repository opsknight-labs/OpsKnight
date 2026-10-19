CREATE TYPE "AuthenticationMode" AS ENUM ('PASSWORD_ONLY', 'SSO_OPTIONAL', 'SSO_REQUIRED');
CREATE TABLE "AuthenticationPolicyImport" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthenticationPolicyImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthenticationPolicyImport_singleton" CHECK ("id" = 'default')
);
CREATE TABLE "AuthenticationPolicy" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "mode" "AuthenticationMode" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "oidcConfigVersion" INTEGER,
  "enforcedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "migratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "legacyEmergencyEmail" TEXT,
  "legacySnapshot" JSONB NOT NULL,
  CONSTRAINT "AuthenticationPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthenticationPolicy_singleton" CHECK ("id" = 'default'),
  CONSTRAINT "AuthenticationPolicy_positive_version" CHECK ("version" > 0)
);
-- Environment-dependent legacy import is an explicit runtime bootstrap transaction.
-- SQL must not guess the previous installation's effective authentication mode.
