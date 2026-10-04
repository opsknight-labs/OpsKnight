ALTER TABLE "RunbookSuggestion" ADD COLUMN "planSnapshot" JSONB;
CREATE TABLE "RunbookExecutionSigningKey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "publicKey" TEXT NOT NULL,
  "privateKeyEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
