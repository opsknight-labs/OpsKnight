-- CreateEnum
CREATE TYPE "UserTokenType" AS ENUM ('INVITE', 'PASSWORD_RESET', 'ADMIN_RESET_LINK');

-- CreateTable
CREATE TABLE "UserToken" (
    "id" TEXT NOT NULL,
    "type" "UserTokenType" NOT NULL,
    "identifier" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserToken_identifier_type_idx" ON "UserToken"("identifier", "type");

-- CreateIndex
CREATE INDEX "UserToken_expiresAt_idx" ON "UserToken"("expiresAt");

