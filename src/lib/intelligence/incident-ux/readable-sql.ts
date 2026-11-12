import 'server-only';
import { Prisma } from '@prisma/client';
import { incidentReadWhereParts } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

/**
 * SQL form of `incidentReadWhere` for one raw, batched query. Built from `incidentReadWhereParts`, the
 * single source of truth for incident visibility, so the two cannot disagree on who may read what; an
 * integration test pins the parity. Throws exactly when `incidentReadWhere` throws (access denied).
 *
 * `alias` must be a trusted, literal table alias.
 */
export function incidentReadableSql(alias: string, actor: AuthorizationActor): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('invalid alias');
  const parts = incidentReadWhereParts(actor);
  if (parts.global) return Prisma.sql`TRUE`;
  const a = Prisma.raw(`"${alias}"`);
  const teams = [...actor.teamIds];
  const teamArray = teams.length
    ? Prisma.sql`ARRAY[${Prisma.join(teams)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  return Prisma.sql`(
    ${a}."assigneeId" = ${actor.id}
    OR EXISTS (SELECT 1 FROM "IncidentWatcher" w WHERE w."incidentId" = ${a}."id" AND w."userId" = ${actor.id})
    OR (${a}."visibility" = 'PUBLIC' AND (
      ${a}."teamId" = ANY(${teamArray})
      OR EXISTS (SELECT 1 FROM "Service" sv WHERE sv."id" = ${a}."serviceId" AND sv."teamId" = ANY(${teamArray}))
    ))
  )`;
}
