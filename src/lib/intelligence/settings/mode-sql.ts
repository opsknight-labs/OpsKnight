import 'server-only';
import { Prisma } from '@prisma/client';
import { GLOBAL_POLICY_SCOPE_KEY, servicePolicyScopeKey } from '../contract';

/** Cheap candidate pre-filter. Always resolve and validate the complete policy before reading text. */
export function candidatePolicyModeSql(serviceId: Prisma.Sql): Prisma.Sql {
  const mode = (scope: Prisma.Sql) => Prisma.sql`(
    SELECT CASE WHEN jsonb_typeof(v.definition) = 'object'
      AND COALESCE(v.definition->>'schemaVersion', '1') = '1'
      THEN v.mode ELSE 'OFF'::"IntelligenceMode" END
    FROM "IntelligencePolicy" p JOIN "IntelligencePolicyVersion" v
      ON v."policyId" = p.id AND v.version = p."headVersion"
    WHERE p."scopeKey" = ${scope} AND p."overrideActive" AND p."headVersion" > 0
  )`;
  return Prisma.sql`CASE WHEN EXISTS (
    SELECT 1 FROM "IntelligenceSettings" WHERE id = 'default' AND enabled
  ) THEN COALESCE(${mode(Prisma.sql`${servicePolicyScopeKey('')} || ${serviceId}`)},
    ${mode(Prisma.sql`${GLOBAL_POLICY_SCOPE_KEY}`)}, 'OFF'::"IntelligenceMode")
    ELSE 'OFF'::"IntelligenceMode" END`;
}
