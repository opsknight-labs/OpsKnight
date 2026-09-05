-- Commit the enum value separately. PostgreSQL does not permit a newly-added
-- enum value to be used safely until the ALTER TYPE transaction is committed.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CHATOPS_INTENT';
