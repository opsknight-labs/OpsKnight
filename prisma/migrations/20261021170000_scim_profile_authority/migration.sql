ALTER TABLE "ScimConnector" ADD COLUMN "profileFields" TEXT[] NOT NULL DEFAULT ARRAY['name', 'email', 'title', 'department', 'photos']::TEXT[];
