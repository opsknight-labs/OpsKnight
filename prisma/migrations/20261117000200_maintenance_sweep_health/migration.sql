-- Scheduler health: when the maintenance-window end sweep last ran.
ALTER TABLE "cron_scheduler_state" ADD COLUMN "lastMaintenanceSweepAt" TIMESTAMP(3);
