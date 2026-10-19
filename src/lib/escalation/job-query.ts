import { Prisma } from '@prisma/client';

/** Keep the indexed JSON path literal even when PostgreSQL uses a generic plan. */
export function escalationJobLookupQuery(logicalKey: string) {
  return Prisma.sql`
    SELECT id FROM "BackgroundJob"
    WHERE type = 'ESCALATION'::"JobType"
      AND status IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus")
      AND payload #> ARRAY['logicalKey']::text[] = ${JSON.stringify(logicalKey)}::jsonb
    LIMIT 1
  `;
}
