-- Intelligence fields as automation conditions (J1.4): one defaulted switch, default off. No row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "automationIntelligenceFieldsEnabled" BOOLEAN NOT NULL DEFAULT false;
