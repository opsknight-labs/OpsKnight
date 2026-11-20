-- Opt-in only: existing groups retain no authority over system roles.
ALTER TABLE "ScimGroup" ADD COLUMN "systemRole" "Role";
