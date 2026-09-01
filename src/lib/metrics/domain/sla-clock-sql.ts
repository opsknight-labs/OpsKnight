import { Prisma } from '@prisma/client';

function qualified(alias: string | undefined, name: string) {
  if (alias !== undefined && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid SQL alias');
  }
  return Prisma.raw(`${alias ? `"${alias}".` : ''}"${name}"`);
}

/** PostgreSQL equivalent of effectiveMaterializedElapsedMs using [start,end) intervals. */
export function slaEffectiveElapsedSql(evaluationAt: Prisma.Sql, alias?: string) {
  const createdAt = qualified(alias, 'createdAt');
  const pausedMs = qualified(alias, 'slaPausedMs');
  const pauseStartedAt = qualified(alias, 'slaPauseStartedAt');
  return Prisma.sql`GREATEST(0,
    EXTRACT(EPOCH FROM (${evaluationAt} - ${createdAt})) * 1000
    - COALESCE(${pausedMs}, 0)
    - CASE
        WHEN ${pauseStartedAt} IS NOT NULL AND ${pauseStartedAt} < ${evaluationAt}
        THEN GREATEST(0, EXTRACT(EPOCH FROM (
          ${evaluationAt} - GREATEST(${pauseStartedAt}, ${createdAt})
        )) * 1000)
        ELSE 0
      END
  )`;
}
