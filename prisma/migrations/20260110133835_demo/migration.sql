/*
  Warnings:

  - You are about to drop the `SearchPreset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SearchPresetUsage` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SearchPreset" DROP CONSTRAINT "SearchPreset_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SearchPresetUsage" DROP CONSTRAINT "SearchPresetUsage_presetId_fkey";

-- DropForeignKey
ALTER TABLE "SearchPresetUsage" DROP CONSTRAINT "SearchPresetUsage_userId_fkey";

-- DropTable
-- DropTable
DROP TABLE IF EXISTS "SearchPreset";

-- DropTable
DROP TABLE IF EXISTS "SearchPresetUsage";
