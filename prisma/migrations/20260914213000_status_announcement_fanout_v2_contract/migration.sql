-- Rolling-deploy contract for generation-aware status-page announcement fan-out.
--
-- V2 uses both a versioned JobType and V2-only pending/processing states. The
-- state split is intentional: workers from the previous release only claim
-- PENDING/PROCESSING rows, so they cannot claim or fail a V2 job they do not
-- understand while a deployment is rolling.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'PENDING_V2';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'PROCESSING_V2';
