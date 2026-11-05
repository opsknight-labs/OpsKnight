-- Additive. Opt-in CORS for exact browser origins, and opt-in 403 insufficient_scope step-up.
-- Both default to the previous behaviour: no foreign Origin is accepted and no step-up is sent.
ALTER TABLE "McpPolicy" ADD COLUMN "allowedBrowserOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "McpPolicy" ADD COLUMN "scopeStepUpEnabled" BOOLEAN NOT NULL DEFAULT false;
