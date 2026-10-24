import { Prisma } from '@prisma/client';

type Classification = Pick<
  Prisma.IncidentClassificationPolicyGetPayload<{ include: { rules: true } }>,
  | 'id'
  | 'scopeKey'
  | 'version'
  | 'inheritWorkspace'
  | 'derivePriorityFromUrgency'
  | 'priorityFallbackMode'
  | 'rules'
>;
type Sla = Pick<
  Prisma.IncidentSlaPolicyGetPayload<{ include: { rules: true } }>,
  | 'id'
  | 'scopeKey'
  | 'version'
  | 'inheritWorkspace'
  | 'baseAckTargetMs'
  | 'baseResolveTargetMs'
  | 'rules'
>;
type Support = Pick<
  Prisma.ResponseSupportHoursPolicyGetPayload<{ include: { windows: true; exceptions: true } }>,
  | 'id'
  | 'scopeKey'
  | 'version'
  | 'timezone'
  | 'inheritWorkspace'
  | 'mode'
  | 'windows'
  | 'exceptions'
>;

const classificationSql = Prisma.sql`
  SELECT to_jsonb(policy) || jsonb_build_object('rules', (
    SELECT COALESCE(jsonb_agg(to_jsonb(rule)), '[]'::jsonb)
    FROM "IncidentClassificationPolicyRule" rule WHERE rule."policyId" = policy.id
  )) AS snapshot FROM scopes
  JOIN LATERAL (
    SELECT * FROM "IncidentClassificationPolicy" p
    WHERE p."scopeKey" = scopes.key AND p."sealedAt" IS NOT NULL
    ORDER BY p.version DESC LIMIT 1
  ) policy ON true ORDER BY scopes.position`;
const slaSql = Prisma.sql`
  SELECT to_jsonb(policy) || jsonb_build_object('rules', (
    SELECT COALESCE(jsonb_agg(to_jsonb(rule)), '[]'::jsonb)
    FROM "IncidentSlaPolicyRule" rule WHERE rule."policyId" = policy.id
  )) AS snapshot FROM scopes
  JOIN LATERAL (
    SELECT * FROM "IncidentSlaPolicy" p
    WHERE p."scopeKey" = scopes.key AND p."sealedAt" IS NOT NULL
    ORDER BY p.version DESC LIMIT 1
  ) policy ON true ORDER BY scopes.position`;
const supportSql = Prisma.sql`
  SELECT to_jsonb(policy) || jsonb_build_object(
    'windows', (SELECT COALESCE(jsonb_agg(to_jsonb(support_window)), '[]'::jsonb)
      FROM "ResponseSupportWindow" support_window WHERE support_window."policyId" = policy.id),
    'exceptions', (SELECT COALESCE(jsonb_agg(to_jsonb(support_exception)), '[]'::jsonb)
      FROM "ResponseSupportException" support_exception WHERE support_exception."policyId" = policy.id)
  ) AS snapshot FROM scopes
  JOIN LATERAL (
    SELECT * FROM "ResponseSupportHoursPolicy" p
    WHERE p."scopeKey" = scopes.key AND p."sealedAt" IS NOT NULL
    ORDER BY p.version DESC LIMIT 1
  ) policy ON true ORDER BY scopes.position`;

/** One transaction-local SQL snapshot, bounded by scopes and latest versions.
 * Mutable publication pointers are never cached. Scope order remains authoritative.
 * SQL fragments are fixed here, not supplied by callers or policy content.
 */
async function read<T>(
  tx: Prisma.TransactionClient,
  keys: string[],
  query: Prisma.Sql
): Promise<T[]> {
  if (!keys.length) return [];
  if (keys.length > 3) throw new Error('Invalid incident policy scope count');
  const rows = await tx.$queryRaw<Array<{ snapshot: T }>>`
    WITH scopes AS (SELECT key, position FROM unnest(${keys}::text[])
      WITH ORDINALITY AS requested(key, position))
    ${query}`;
  return rows.map(row => row.snapshot);
}

export function readPublishedClassificationPolicies(tx: Prisma.TransactionClient, keys: string[]) {
  return read<Classification>(tx, keys, classificationSql);
}
export function readPublishedSlaPolicies(tx: Prisma.TransactionClient, keys: string[]) {
  return read<Sla>(tx, keys, slaSql);
}
export async function readPublishedSupportPolicies(tx: Prisma.TransactionClient, keys: string[]) {
  type StoredSupport = Omit<Support, 'exceptions'> & {
    exceptions: Array<Omit<Support['exceptions'][number], 'localDate'> & { localDate: string }>;
  };
  const rows = await read<StoredSupport>(tx, keys, supportSql);
  return rows.map(policy => ({
    ...policy,
    exceptions: policy.exceptions.map(exception => ({
      ...exception,
      localDate: new Date(exception.localDate),
    })),
  }));
}
