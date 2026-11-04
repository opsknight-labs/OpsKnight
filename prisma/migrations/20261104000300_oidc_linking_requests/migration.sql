-- Someone whose first SSO sign-in needs an administrator's approval asks for it automatically.
-- One open request per person; repeat attempts update it instead of notifying again.
CREATE TABLE "OidcLinkingRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "OidcLinkingRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OidcLinkingRequest_userId_key" ON "OidcLinkingRequest"("userId");
CREATE INDEX "OidcLinkingRequest_lastAttemptAt_idx" ON "OidcLinkingRequest"("lastAttemptAt");
ALTER TABLE "OidcLinkingRequest" ADD CONSTRAINT "OidcLinkingRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
