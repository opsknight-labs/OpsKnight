-- AlterTable
ALTER TABLE "OidcConfig" ADD COLUMN     "profileMapping" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "lastOidcSync" TIMESTAMP(3);
