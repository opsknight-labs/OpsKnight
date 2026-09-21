CREATE TYPE "PrivacyVerificationStatus" AS ENUM ('PENDING', 'VERIFIED');
CREATE TYPE "PrivacyVerificationMethod" AS ENUM ('OIDC_SESSION', 'EMAIL_CHALLENGE', 'MANUAL_ID_DOCUMENT', 'ADMIN_ATTESTATION');

ALTER TABLE "PrivacyRequest"
  ADD COLUMN "verificationStatus" "PrivacyVerificationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "verificationMethod" "PrivacyVerificationMethod",
  ADD COLUMN "verifiedById" TEXT,
  ADD COLUMN "verificationReference" TEXT;

-- Preserve already verified records without inventing an operator or external evidence.
UPDATE "PrivacyRequest"
SET "verificationStatus" = 'VERIFIED',
    "verificationMethod" = 'ADMIN_ATTESTATION'
WHERE "verifiedAt" IS NOT NULL;

-- Stranded requests must be explicitly verified; never infer verification from status.
-- BEGIN stranded privacy request repair
UPDATE "PrivacyRequest"
SET "status" = 'IDENTITY_VERIFICATION'
WHERE "status" IN ('IN_REVIEW', 'PROCESSING')
  AND "verifiedAt" IS NULL;
-- END stranded privacy request repair

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "PrivacyRequest_verifiedById_fkey"
  FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PrivacyRequest_verifiedById_idx" ON "PrivacyRequest"("verifiedById");
