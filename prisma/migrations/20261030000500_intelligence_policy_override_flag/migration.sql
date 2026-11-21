-- OpsKnight Intelligence: lets a service return to the global policy without deleting its history.
-- Additive and defaulted, so existing policies keep their current behaviour.
ALTER TABLE "IntelligencePolicy" ADD COLUMN "overrideActive" BOOLEAN NOT NULL DEFAULT true;
