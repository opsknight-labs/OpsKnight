-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- AlterTable: constant default, metadata-only on PostgreSQL 11+ (no table rewrite)
ALTER TABLE "User" ADD COLUMN "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';
