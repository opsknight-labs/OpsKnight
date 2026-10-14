ALTER TABLE "EmergencyAccount" ADD COLUMN "authenticationMethod" TEXT NOT NULL DEFAULT 'WEBAUTHN', ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "EmergencyAccount" ADD CONSTRAINT "EmergencyAccount_authentication_method_check" CHECK (
  ("authenticationMethod" = 'WEBAUTHN' AND "passwordHash" IS NULL) OR
  ("authenticationMethod" = 'PASSWORD' AND ("passwordHash" IS NOT NULL OR status = 'DISABLED'))
);
