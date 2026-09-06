import { Prisma } from '@prisma/client';

function qualified(alias: string | undefined, name: string) {
  if (alias !== undefined && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid SQL alias');
  }
  return Prisma.raw(`${alias ? `"${alias}".` : ''}"${name}"`);
}

/** PostgreSQL equivalent of effectiveElapsedMs using the union of clipped durable pause rows. */
export function slaEffectiveElapsedSql(evaluationAt: Prisma.Sql, alias?: string) {
  const createdAt = qualified(alias, 'createdAt');
  const incidentId = qualified(alias, 'id');
  return Prisma.sql`GREATEST(0,
    EXTRACT(EPOCH FROM (${evaluationAt} - ${createdAt})) * 1000
    - COALESCE((
      SELECT SUM(EXTRACT(EPOCH FROM (island_end - island_start)) * 1000)
      FROM (
        SELECT MIN(start_at) AS island_start, MAX(end_at) AS island_end
        FROM (
          SELECT marked.*,
            SUM(CASE WHEN prior_end IS NULL OR start_at > prior_end THEN 1 ELSE 0 END)
              OVER (ORDER BY start_at, end_at) AS island
          FROM (
            SELECT clipped.*,
              MAX(end_at) OVER (
                ORDER BY start_at, end_at
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ) AS prior_end
            FROM (
              SELECT
                GREATEST(p."startedAt", ${createdAt}) AS start_at,
                LEAST(COALESCE(p."endedAt", ${evaluationAt}), ${evaluationAt}) AS end_at
              FROM "IncidentSlaPause" p
              WHERE p."incidentId" = ${incidentId}
                AND p."startedAt" < ${evaluationAt}
                AND COALESCE(p."endedAt", ${evaluationAt}) > ${createdAt}
            ) clipped
          ) marked
        ) numbered
        GROUP BY island
      ) islands
    ), 0)
  )`;
}
