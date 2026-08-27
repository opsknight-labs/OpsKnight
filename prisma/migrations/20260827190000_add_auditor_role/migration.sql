-- Add the read-only enterprise Auditor role without changing existing users.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AUDITOR';
