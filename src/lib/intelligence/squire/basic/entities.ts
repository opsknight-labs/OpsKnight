import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  dashboardUserReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { ENTITY_TTL_MS, TtlCache } from '../../assistant/cache';

export type EntityKind = 'service' | 'team' | 'person' | 'schedule';

export interface EntityMatch {
  kind: EntityKind;
  id: string;
  name: string;
  /** 0–1; 1 is an exact (case-insensitive) name match. */
  similarity: number;
}

/** Below this a fuzzy match is noise; above `CONFIDENT` it is applied without asking. */
export const ENTITY_MIN_SIMILARITY = 0.35;
export const ENTITY_CONFIDENT_SIMILARITY = 0.6;
export const ENTITY_LONE_SIMILARITY = 0.45;
/** A name that contains the typed text is at least this plausible, however short the text. */
const SUBSTRING_SIMILARITY = 0.5;
const CANDIDATES = 8;

const cache = new TtlCache<EntityMatch[]>(ENTITY_TTL_MS, 2_000);
let trigramChecked = 0;
let trigramAvailable = false;

async function hasTrigram(): Promise<boolean> {
  if (Date.now() - trigramChecked < 60_000) return trigramAvailable;
  trigramChecked = Date.now();
  try {
    const rows = await prisma.$queryRaw<Array<{ installed: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS installed`;
    trigramAvailable = rows[0]?.installed === true;
  } catch {
    trigramAvailable = false;
  }
  return trigramAvailable;
}

const scopeKey = (actor: AuthorizationActor) =>
  `${actor.id}:${actor.role}:${[...actor.teamIds].sort().join(',')}`;

/** Simple similarity used when pg_trgm is not installed: shared-prefix and containment. */
function fallbackSimilarity(name: string, term: string): number {
  const a = name.toLowerCase();
  const b = term.toLowerCase();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.7;
  let prefix = 0;
  // eslint-disable-next-line security/detect-object-injection -- numeric index into a string
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  return prefix >= 3 ? 0.4 + prefix / (2 * Math.max(a.length, b.length)) : 0;
}

type Table = { table: 'Service' | 'Team' | 'OnCallSchedule' | 'User'; kind: EntityKind };
const TABLES: Table[] = [
  { table: 'Service', kind: 'service' },
  { table: 'Team', kind: 'team' },
  { table: 'OnCallSchedule', kind: 'schedule' },
  { table: 'User', kind: 'person' },
];

async function candidates(
  term: string,
  table: Table
): Promise<Array<{ id: string; name: string; similarity: number }>> {
  const relation = Prisma.raw(`"${table.table}"`);
  if (await hasTrigram()) {
    return prisma.$queryRaw<Array<{ id: string; name: string; similarity: number }>>(Prisma.sql`
      SELECT "id", "name",
        GREATEST(
          similarity(lower("name"), ${term.toLowerCase()}),
          CASE WHEN strpos(lower("name"), ${term.toLowerCase()}) > 0 THEN ${SUBSTRING_SIMILARITY} ELSE 0 END
        )::float8 AS similarity
      FROM ${relation}
      WHERE "name" IS NOT NULL AND (
        similarity(lower("name"), ${term.toLowerCase()}) >= ${ENTITY_MIN_SIMILARITY}
        OR strpos(lower("name"), ${term.toLowerCase()}) > 0)
      ORDER BY similarity DESC, "name" ASC
      LIMIT ${CANDIDATES}`);
  }
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
    SELECT "id", "name" FROM ${relation}
    WHERE "name" IS NOT NULL AND (lower("name") LIKE ${`%${term.toLowerCase()}%`} OR lower("name") LIKE ${`${term.slice(0, 3).toLowerCase()}%`})
    ORDER BY "name" ASC LIMIT ${CANDIDATES * 4}`);
  return rows
    .map(row => ({ ...row, similarity: fallbackSimilarity(row.name, term) }))
    .filter(row => row.similarity >= ENTITY_MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CANDIDATES);
}

/** Only ids the person may read survive; the similarity query itself never leaks a name. */
async function visible(
  actor: AuthorizationActor,
  kind: EntityKind,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const where = { id: { in: ids } };
    const rows =
      kind === 'service'
        ? await prisma.service.findMany({
            where: { AND: [where, serviceReadWhere(actor)] },
            select: { id: true },
          })
        : kind === 'team'
          ? await prisma.team.findMany({
              where: { AND: [where, teamReadWhere(actor)] },
              select: { id: true },
            })
          : kind === 'schedule'
            ? await prisma.onCallSchedule.findMany({
                where: { AND: [where, scheduleReadWhere(actor)] },
                select: { id: true },
              })
            : await prisma.user.findMany({
                where: { AND: [where, { status: 'ACTIVE' }, dashboardUserReadWhere(actor)] },
                select: { id: true },
              });
    return new Set(rows.map(row => row.id));
  } catch {
    return new Set();
  }
}

/**
 * Finds services, teams, schedules and people whose names resemble `term` (typos included), limited to what
 * the person may read. Results are cached for a minute per person and term.
 */
export async function resolveEntities(
  actor: AuthorizationActor,
  term: string,
  kinds: readonly EntityKind[] = ['service', 'team', 'schedule', 'person']
): Promise<EntityMatch[]> {
  const clean = term.trim().slice(0, 80);
  if (clean.length < 2) return [];
  const key = `${scopeKey(actor)}|${kinds.join(',')}|${clean.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const matches: EntityMatch[] = [];
  for (const table of TABLES.filter(entry => kinds.includes(entry.kind))) {
    let rows: Array<{ id: string; name: string; similarity: number }> = [];
    try {
      rows = await candidates(clean, table);
    } catch {
      rows = [];
    }
    const allowed = await visible(
      actor,
      table.kind,
      rows.map(row => row.id)
    );
    for (const row of rows)
      if (allowed.has(row.id))
        matches.push({ kind: table.kind, id: row.id, name: row.name, similarity: row.similarity });
  }
  matches.sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name));
  cache.set(key, matches);
  return matches;
}

/** The single confident match for a term, or null when none or several are plausible. */
export function confidentMatch(
  matches: readonly EntityMatch[],
  kind?: EntityKind
): EntityMatch | null {
  const pool = kind ? matches.filter(match => match.kind === kind) : matches;
  const [best, second] = pool;
  if (!best) return null;
  // A lone plausible candidate is accepted at a lower bar; with rivals it must be clearly ahead.
  if (best.similarity < (second ? ENTITY_CONFIDENT_SIMILARITY : ENTITY_LONE_SIMILARITY))
    return null;
  if (
    second &&
    second.similarity >= best.similarity - 0.1 &&
    second.name.toLowerCase() !== best.name.toLowerCase()
  )
    return null;
  return best;
}

/** Test hook. */
export function resetEntityCache(): void {
  cache.clear();
  trigramChecked = 0;
}
