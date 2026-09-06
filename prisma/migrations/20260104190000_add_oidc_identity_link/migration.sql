-- Create stable OIDC identity link table (issuer + subject -> user)
CREATE TABLE IF NOT EXISTS "OidcIdentity" (
  "id" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OidcIdentity_pkey" PRIMARY KEY ("id")
);

-- Enforce uniqueness of issuer+subject pairs
CREATE UNIQUE INDEX IF NOT EXISTS "OidcIdentity_issuer_subject_key" ON "OidcIdentity"("issuer", "subject");

-- Foreign key to User
DO $$ BEGIN
  ALTER TABLE "OidcIdentity"
  ADD CONSTRAINT "OidcIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Supporting indexes
CREATE INDEX IF NOT EXISTS "OidcIdentity_userId_idx" ON "OidcIdentity"("userId");
CREATE INDEX IF NOT EXISTS "OidcIdentity_issuer_idx" ON "OidcIdentity"("issuer");

