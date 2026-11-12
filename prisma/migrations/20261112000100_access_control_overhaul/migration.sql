-- CreateEnum
CREATE TYPE "AccessGrantSource" AS ENUM ('REQUEST', 'BREAK_GLASS', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccessRequestKind" AS ENUM ('ORG_ROLE', 'TEAM_MEMBERSHIP', 'TEAM_ROLE');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AccessReviewStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccessReviewDecision" AS ENUM ('PENDING', 'KEEP', 'REVOKE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_REQUEST';
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_GRANT';
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_DECISION';
ALTER TYPE "AuditEntityType" ADD VALUE 'CUSTOM_ROLE';
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCESS_REVIEW';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customRoleId" TEXT;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "accessBreakGlassEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accessBreakGlassMaxMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "accessRequestsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accessReviewIntervalDays" INTEGER,
ADD COLUMN     "accessReviewLastStartedAt" TIMESTAMP(3),
ADD COLUMN     "accessSelfApprovalAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accessUserIncidentActionsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" TEXT[],
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "AccessGrantSource" NOT NULL,
    "role" "Role",
    "teamId" TEXT,
    "teamRole" "TeamRole",
    "previousTeamRole" "TeamRole",
    "createdMembership" BOOLEAN NOT NULL DEFAULT false,
    "incidentId" TEXT,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "endProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "kind" "AccessRequestKind" NOT NULL,
    "requestedRole" "Role",
    "teamId" TEXT,
    "requestedTeamRole" "TeamRole",
    "reason" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "originPath" TEXT,
    "requiredCapability" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "grantId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessReview" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AccessReviewStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessReviewItem" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectLabel" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "decision" "AccessReviewDecision" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AccessReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_name_key" ON "CustomRole"("name");

-- CreateIndex
CREATE INDEX "AccessGrant_userId_revokedAt_expiresAt_idx" ON "AccessGrant"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "AccessGrant_endProcessedAt_expiresAt_idx" ON "AccessGrant"("endProcessedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "AccessGrant_source_createdAt_idx" ON "AccessGrant"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRequest_grantId_key" ON "AccessRequest"("grantId");

-- CreateIndex
CREATE INDEX "AccessRequest_status_createdAt_idx" ON "AccessRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccessRequest_requesterId_status_idx" ON "AccessRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_teamId_status_idx" ON "AccessRequest"("teamId", "status");

-- CreateIndex
CREATE INDEX "AccessReview_status_createdAt_idx" ON "AccessReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccessReviewItem_reviewId_decision_idx" ON "AccessReviewItem"("reviewId", "decision");

-- CreateIndex
CREATE INDEX "AccessReviewItem_userId_idx" ON "AccessReviewItem"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AccessReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

