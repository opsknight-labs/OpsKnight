-- Add tokenVersion to User to support session revocation
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

