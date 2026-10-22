import { Prisma } from '@prisma/client';

export type SecretUsage = {
  id: string;
  sourceType: 'SERVICE_RULE' | 'EXECUTION' | 'INPUT_DEFAULT';
  sourceId: string;
  runbookId: string;
  runbookVersionId: string | null;
  serviceId: string | null;
  createdAt: Date;
};

/** Shared by the API and its scale harness so EXPLAIN measures production SQL. */
export function secretUsageQuery(
  reference: string,
  limit: number,
  cursor: { createdAt: string; id: string } | null
) {
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'rule:' || r.id AS id, 'SERVICE_RULE'::text AS "sourceType", r.id AS "sourceId", r."runbookId", r."runbookVersionId", r."serviceId", r."createdAt"
       FROM "ServiceRunbookBinding" r WHERE jsonb_path_query_array(r."inputValues", '$.*') @> ${JSON.stringify([reference])}::jsonb
      UNION ALL
      SELECT 'execution:' || e.id, 'EXECUTION'::text, e.id, e."runbookId", e."runbookVersionId", e."serviceId", e."createdAt"
       FROM "RunbookExecution" e WHERE jsonb_path_query_array(e."inputValues", '$.*') @> ${JSON.stringify([reference])}::jsonb
      UNION ALL
      SELECT 'default:' || i.id, 'INPUT_DEFAULT'::text, i.id, v."runbookId", i."runbookVersionId", NULL::text, i."createdAt"
       FROM "RunbookInput" i JOIN "RunbookVersion" v ON v.id = i."runbookVersionId"
       WHERE i.type = 'SECRET_REF' AND i."defaultValue" = ${reference}
    ) usage
    ${cursor ? Prisma.sql`WHERE ("createdAt", id) < (${new Date(cursor.createdAt)}, ${cursor.id})` : Prisma.empty}
    ORDER BY "createdAt" DESC, id DESC LIMIT ${limit + 1}
   `;
}
