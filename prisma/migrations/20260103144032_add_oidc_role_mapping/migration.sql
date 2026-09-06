-- AlterTable
ALTER TABLE "OidcConfig" ADD COLUMN     "customScopes" TEXT,
ADD COLUMN     "roleMapping" JSONB DEFAULT '[]';
