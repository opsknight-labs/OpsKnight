ALTER TABLE "AuthenticationPolicy"
  ADD COLUMN "passwordRecoveryUserId" TEXT,
  ADD COLUMN "passwordRecoveryExpiresAt" TIMESTAMP(3),
  ADD COLUMN "recoveryDegradedAt" TIMESTAMP(3),
  ADD CONSTRAINT "AuthenticationPolicy_scoped_recovery_pair" CHECK
    (("passwordRecoveryUserId" IS NULL) = ("passwordRecoveryExpiresAt" IS NULL));

ALTER TABLE "UserDevice" ADD COLUMN "sessionExpiresAt" TIMESTAMP(3);
-- Unknown legacy expiration remains NULL and is conservatively counted. Newly
-- registered/renewed sessions populate this column without parsing JSON in scans.
CREATE INDEX "UserDevice_platform_sessionExpiresAt_idx" ON "UserDevice"("platform", "sessionExpiresAt");

CREATE TABLE "AuthenticationFailureWindow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthenticationFailureWindow_positive_count" CHECK ("count" > 0)
);
CREATE INDEX "AuthenticationFailureWindow_expiresAt_idx" ON "AuthenticationFailureWindow"("expiresAt");
