/*
  Warnings:

  - Added the required column `metricType` to the `SLADefinition` table without a default value. This is not possible if the table is not empty.
  - Added the required column `target` to the `SLADefinition` table without a default value. This is not possible if the table is not empty.
  - Added the required column `window` to the `SLADefinition` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SLADefinition" ADD COLUMN     "metricType" TEXT NOT NULL,
ADD COLUMN     "target" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "window" TEXT NOT NULL;
