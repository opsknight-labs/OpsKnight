-- Nullable read-only projection. No historical table rewrite or blocking index build.
-- Run scripts/prepare-authentication-diagnostics.cjs after migrate deploy.
SET lock_timeout = '5s';
ALTER TABLE "UserDevice" ADD COLUMN "sessionPolicyVersion" INTEGER;
