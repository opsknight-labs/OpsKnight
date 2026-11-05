-- An administrator test that fails must say why. The code is from a fixed catalog and the
-- diagnostics hold claim names and the values of mapped claims only, never tokens.
ALTER TABLE "OidcTestFlow" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "OidcTestFlow" ADD COLUMN "diagnostics" JSONB;
