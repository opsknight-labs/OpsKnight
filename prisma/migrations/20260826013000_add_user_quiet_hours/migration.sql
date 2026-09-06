-- Quiet Hours is an explicit user opt-in. Existing and new users keep full paging by default.
ALTER TABLE "User"
ADD COLUMN "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "quietHoursStartMinutes" INTEGER NOT NULL DEFAULT 1080,
ADD COLUMN "quietHoursEndMinutes" INTEGER NOT NULL DEFAULT 480,
ADD COLUMN "quietHoursWeekendAllDay" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "User"
ADD CONSTRAINT "User_quietHoursStartMinutes_check"
CHECK ("quietHoursStartMinutes" >= 0 AND "quietHoursStartMinutes" < 1440),
ADD CONSTRAINT "User_quietHoursEndMinutes_check"
CHECK ("quietHoursEndMinutes" >= 0 AND "quietHoursEndMinutes" < 1440),
ADD CONSTRAINT "User_quietHours_window_check"
CHECK ("quietHoursStartMinutes" <> "quietHoursEndMinutes");
