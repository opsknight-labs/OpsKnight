-- CreateTable
CREATE TABLE "UserAvatar" (
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAvatar_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserAvatar" ADD CONSTRAINT "UserAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
