-- CreateTable
CREATE TABLE "AnalyticsDigestSubscription" (
    "userId" TEXT NOT NULL,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "token" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDigestSubscription_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDigestSubscription_token_key" ON "AnalyticsDigestSubscription"("token");

-- AddForeignKey
ALTER TABLE "AnalyticsDigestSubscription" ADD CONSTRAINT "AnalyticsDigestSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
