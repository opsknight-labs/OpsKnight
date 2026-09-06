ALTER TABLE "User"
ADD COLUMN "invitationGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UserToken"
ADD COLUMN "userId" TEXT,
ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "revokedAt" TIMESTAMP(3);

UPDATE "UserToken" AS token
SET "userId" = matched_user."id"
FROM "User" AS matched_user
WHERE lower(token."identifier") = lower(matched_user."email");

CREATE INDEX "UserToken_userId_type_generation_idx"
ON "UserToken"("userId", "type", "generation");

ALTER TABLE "UserToken"
ADD CONSTRAINT "UserToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OidcLinkingApproval" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "generation" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OidcLinkingApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OidcLinkingApproval_userId_key" ON "OidcLinkingApproval"("userId");
CREATE INDEX "OidcLinkingApproval_approvedById_idx" ON "OidcLinkingApproval"("approvedById");
ALTER TABLE "OidcLinkingApproval"
ADD CONSTRAINT "OidcLinkingApproval_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_userId_fkey";
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
