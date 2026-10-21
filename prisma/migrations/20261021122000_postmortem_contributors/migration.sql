CREATE TYPE "PostmortemContributorRole" AS ENUM ('AUTHOR', 'REVIEWER', 'CONTRIBUTOR');
CREATE TABLE "PostmortemContributor" (
  "postmortemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "PostmortemContributorRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostmortemContributor_pkey" PRIMARY KEY ("postmortemId", "userId"),
  CONSTRAINT "PostmortemContributor_postmortemId_fkey" FOREIGN KEY ("postmortemId") REFERENCES "Postmortem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PostmortemContributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PostmortemContributor_userId_idx" ON "PostmortemContributor"("userId");
