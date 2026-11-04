-- Role policy v2: a configurable default role, an option to deny unmatched users, a choice of
-- precedence, case-insensitive rules, domain-trusted linking and group-to-team mapping.
ALTER TABLE "OidcConfig" ADD COLUMN "defaultRole" "Role" NOT NULL DEFAULT 'USER';
ALTER TABLE "OidcConfig" ADD COLUMN "unmatchedPolicy" TEXT NOT NULL DEFAULT 'DEFAULT_ROLE';
ALTER TABLE "OidcConfig" ADD COLUMN "rolePrecedence" TEXT NOT NULL DEFAULT 'HIGHEST_ROLE';
ALTER TABLE "OidcConfig" ADD COLUMN "domainTrustedLinking" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OidcConfig" ADD COLUMN "teamMapping" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "OidcConfig" ADD CONSTRAINT "OidcConfig_unmatchedPolicy_check"
  CHECK ("unmatchedPolicy" IN ('DEFAULT_ROLE', 'DENY'));
ALTER TABLE "OidcConfig" ADD CONSTRAINT "OidcConfig_rolePrecedence_check"
  CHECK ("rolePrecedence" IN ('FIRST_MATCH', 'HIGHEST_ROLE'));

-- Existing installs keep exactly the behaviour they were configured and tested with:
-- rules are evaluated in order and match case-sensitively.
UPDATE "OidcConfig" SET "rolePrecedence" = 'FIRST_MATCH';
UPDATE "OidcConfig"
SET "roleMapping" = (
  SELECT COALESCE(jsonb_agg(rule || '{"caseSensitive": true}'::jsonb), '[]'::jsonb)
  FROM jsonb_array_elements("roleMapping") AS rule
)
WHERE jsonb_typeof("roleMapping") = 'array';

UPDATE "OidcRevision"
SET "configuration" = jsonb_set(
  "configuration" || '{"rolePrecedence": "FIRST_MATCH"}'::jsonb,
  '{roleMapping}',
  (
    SELECT COALESCE(jsonb_agg(rule || '{"caseSensitive": true}'::jsonb), '[]'::jsonb)
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof("configuration"->'roleMapping') = 'array'
        THEN "configuration"->'roleMapping' ELSE '[]'::jsonb END
    ) AS rule
  )
)
WHERE NOT ("configuration" ? 'rolePrecedence');

-- Values of the claims referenced by role and team rules, as last seen at sign-in. Lets the
-- console preview who a rule change affects and suggest real group values. Bounded by the
-- application; covered by privacy erasure through the identity row.
ALTER TABLE "OidcIdentity" ADD COLUMN "claimSnapshot" JSONB;
ALTER TABLE "OidcIdentity" ADD COLUMN "claimSnapshotAt" TIMESTAMP(3);
