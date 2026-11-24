-- Squire: opt-in automatic investigations of high-urgency incidents, per service.
ALTER TABLE "SquireServicePolicy" ADD COLUMN "investigationEnabled" BOOLEAN NOT NULL DEFAULT false;
