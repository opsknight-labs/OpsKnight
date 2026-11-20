-- People suggestions (M5 items 3, 7, 8): one defaulted switch, default off. No row is rewritten.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "IntelligenceSettings"
  ADD COLUMN "peopleInsightsEnabled" BOOLEAN NOT NULL DEFAULT false;
