-- M5.1: per-status-page cadence for the incident page's "next update due" chip. Null means the 30 minute default.
SET lock_timeout = '2s';
SET statement_timeout = '10s';

ALTER TABLE "StatusPage" ADD COLUMN "updateCadenceMinutes" INTEGER;
