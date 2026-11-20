-- Expand-only: one more operations-insights area switch (intelligence early warnings), off by default.
ALTER TABLE "IntelligenceSettings" ADD COLUMN "opsInsightsIntelligenceEnabled" BOOLEAN NOT NULL DEFAULT false;
