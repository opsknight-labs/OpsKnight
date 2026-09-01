import { Prisma } from '@prisma/client';

function qualified(alias: string | undefined, name: string) {
  if (alias !== undefined && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid SQL alias');
  }
  return Prisma.raw(`${alias ? `"${alias}".` : ''}"${name}"`);
}

/** PostgreSQL equivalent of effectiveElapsedMs using clipped durable [start,end) pause rows. */
export function slaEffectiveElapsedSql(evaluationAt: Prisma.Sql, alias?: string) {
  const createdAt = qualified(alias, 'createdAt');
  const incidentId = qualified(alias, 'id');
  return Prisma.sql`GREATEST(0,
    EXTRACT(EPOCH FROM (${evaluationAt} - ${createdAt})) * 1000
    - COALESCE((
      SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM (
        LEAST(COALESCE(p."endedAt", ${evaluationAt}), ${evaluationAt})
        - GREATEST(p."startedAt", ${createdAt})
      )) * 1000))
      FROM "IncidentSlaPause" p
      WHERE p."incidentId" = ${incidentId}
        AND p."startedAt" < ${evaluationAt}
        AND COALESCE(p."endedAt", ${evaluationAt}) > ${createdAt}
    ), 0)
  )`;
}
