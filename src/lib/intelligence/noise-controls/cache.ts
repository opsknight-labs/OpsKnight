import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { loadActiveEdges } from '../dependencies/service';
import { topologyScope } from '../dependencies/graph';
import {
  PREPAGING_LIMITS,
  noiseControlDefinitionSchema,
  type Matcher,
  type NoiseControlDefinition,
} from './contract';
import { compileMatcher } from './matchers';
import type {
  CompiledPolicy,
  CompiledSuppressionRule,
  CompiledWindow,
  PrePagingLookups,
  PrePagingSnapshot,
} from './evaluate';

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * The in-process snapshot the ingestion hook reads. It is refreshed in the background at most every
 * 30 seconds and the previous snapshot keeps serving while a refresh runs, so the hot path never waits
 * on these reads. A process that has not loaded yet fails open (the hook returns NONE) and triggers a load.
 */

let current: PrePagingSnapshot | null = null;
let loading: Promise<PrePagingSnapshot | null> | null = null;

const WINDOW_HORIZON_MS = 8 * 86_400_000;

function parseMatchers(raw: unknown): Matcher[] {
  return Array.isArray(raw) ? (raw as Matcher[]) : [];
}

function parseDefinition(raw: unknown): NoiseControlDefinition {
  const parsed = noiseControlDefinitionSchema.safeParse(raw);
  return parsed.success ? parsed.data : noiseControlDefinitionSchema.parse({ schemaVersion: 1 });
}

export function compilePolicy(row: {
  scopeKey: string;
  serviceId: string | null;
  mode: 'OFF' | 'SHADOW' | 'ON';
  revision: number;
  definition: unknown;
}): CompiledPolicy {
  const definition = parseDefinition(row.definition);
  return {
    scopeKey: row.scopeKey,
    serviceId: row.serviceId,
    mode: row.mode,
    revision: row.revision,
    definition,
    orchestration: definition.orchestration.rules
      .filter(rule => rule.enabled)
      .map(rule => ({
        id: rule.id,
        name: rule.name,
        conditions: rule.conditions.map(compileMatcher),
        actions: rule.actions,
      })),
  };
}

export function compileSuppressionRule(row: {
  id: string;
  name: string;
  serviceId: string | null;
  matchers: unknown;
  effect: 'SUPPRESS' | 'DOWNGRADE';
  downgradeUrgency: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  expiresAt: Date | null;
}): CompiledSuppressionRule | null {
  try {
    return {
      id: row.id,
      name: row.name,
      serviceId: row.serviceId,
      matchers: parseMatchers(row.matchers).map(compileMatcher),
      effect: row.effect,
      downgradeUrgency: row.downgradeUrgency,
      expiresAt: row.expiresAt,
    };
  } catch {
    return null; // A rule that no longer compiles is skipped, never allowed to break the snapshot.
  }
}

export async function loadPrePagingSnapshot(
  client: Client = prisma,
  now: Date = new Date()
): Promise<PrePagingSnapshot> {
  const horizon = new Date(now.getTime() + WINDOW_HORIZON_MS);
  const [policies, windows, rules] = await Promise.all([
    client.noiseControlPolicy.findMany({ where: { mode: { not: 'OFF' } } }),
    client.maintenanceWindow.findMany({
      where: {
        enabled: true,
        endedAt: null,
        startsAt: { lte: horizon },
        OR: [{ recurrence: { not: null } }, { endsAt: { gte: new Date(now.getTime() - 60_000) } }],
      },
      take: 2_000,
    }),
    client.suppressionRule.findMany({
      where: { enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      take: 2_000,
    }),
  ]);
  const teamIds = [
    ...new Set(windows.filter(w => w.scope === 'TEAM' && w.teamId).map(w => w.teamId!)),
  ];
  const serviceTeams = new Map<string, string | null>();
  if (teamIds.length) {
    const services = await client.service.findMany({
      where: { teamId: { in: teamIds } },
      select: { id: true, teamId: true },
      take: 10_000,
    });
    for (const service of services) serviceTeams.set(service.id, service.teamId);
  }
  const compiledPolicies = new Map<string, CompiledPolicy>();
  for (const row of policies) compiledPolicies.set(row.scopeKey, compilePolicy(row));
  const topology = new Map<string, readonly string[]>();
  if (
    [...compiledPolicies.values()].some(
      policy => policy.definition.storm.enabled && policy.definition.storm.topology
    )
  ) {
    const edges = await loadActiveEdges(client);
    for (const policy of compiledPolicies.values()) {
      if (!policy.serviceId || !policy.definition.storm.topology) continue;
      topology.set(policy.serviceId, topologyScope(edges, policy.serviceId) ?? [policy.serviceId]);
    }
  }
  return {
    loadedAt: now.getTime(),
    policies: compiledPolicies,
    windows: windows.map<CompiledWindow>(row => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      serviceId: row.serviceId,
      teamId: row.teamId,
      labelKey: row.labelKey?.toLowerCase() ?? null,
      labelValue: row.labelValue,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      recurrence: row.recurrence,
      effect: row.effect,
      downgradeUrgency: row.downgradeUrgency,
      endedAt: row.endedAt,
    })),
    rules: rules
      .map(compileSuppressionRule)
      .filter((rule): rule is CompiledSuppressionRule => rule !== null),
    serviceTeams,
    topology,
  };
}

/** Current snapshot, or null when this process has not loaded one yet (a load is started). Never blocks. */
export function getPrePagingSnapshot(now: number = Date.now()): PrePagingSnapshot | null {
  if (!current || now - current.loadedAt >= PREPAGING_LIMITS.cacheRefreshMs)
    void refreshPrePagingSnapshot();
  return current;
}

/** Single-flight refresh. Failures keep the previous snapshot and are logged at debug level. */
export function refreshPrePagingSnapshot(): Promise<PrePagingSnapshot | null> {
  if (loading) return loading;
  loading = loadPrePagingSnapshot()
    .then(snapshot => {
      current = snapshot;
      return snapshot;
    })
    .catch(error => {
      logger.debug(
        '[Intelligence] Pre-paging snapshot refresh failed; previous snapshot stays in use',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return current;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Awaits a fresh snapshot: for process start, tests and the settings page preview. */
export async function primePrePagingSnapshot(): Promise<PrePagingSnapshot | null> {
  current = null;
  return refreshPrePagingSnapshot();
}

export function resetPrePagingSnapshot(): void {
  current = null;
  loading = null;
}

/** Index-backed reads for the hook, bound to the ingestion transaction. */
export function prismaLookups(tx: Pick<Prisma.TransactionClient, '$queryRaw'>): PrePagingLookups {
  return {
    async findOpenIncidentByFingerprint(serviceId, fingerprintHash, since) {
      const rows = await tx.$queryRaw<Array<{ id: string; labels: unknown }>>(Prisma.sql`
        SELECT i."id", f."labels" FROM "Alert" a
        JOIN "Incident" i ON i."id" = a."incidentId"
        LEFT JOIN "IncidentFingerprint" f ON f."incidentId" = i."id"
        WHERE a."serviceId" = ${serviceId} AND a."fingerprintHash" = ${fingerprintHash}
          AND a."createdAt" >= ${since}
          AND i."status" IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED')
        ORDER BY a."createdAt" DESC LIMIT 1`);
      const row = rows[0];
      if (!row) return null;
      const labels =
        row.labels && typeof row.labels === 'object' && !Array.isArray(row.labels)
          ? Object.fromEntries(
              Object.entries(row.labels as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            )
          : null;
      return { id: row.id, labels };
    },
    async countRecentIncidents(serviceIds, since) {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*) AS count FROM "Incident"
        WHERE "serviceId" = ANY(${[...serviceIds]}::text[]) AND "createdAt" >= ${since}`);
      return Number(row?.count ?? 0);
    },
    async findStormParent(serviceIds, since) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Incident"
        WHERE "serviceId" = ANY(${[...serviceIds]}::text[]) AND "createdAt" >= ${since}
          AND "status" IN ('OPEN', 'ACKNOWLEDGED')
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`);
      return rows[0] ?? null;
    },
    async recentAlertStatuses(serviceId, key, since, limit) {
      const rows = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT "status" FROM "Alert"
        WHERE "serviceId" = ${serviceId} AND "createdAt" >= ${since}
          AND ("dedupKey" = ${key.dedupKey} OR (${key.fingerprintHash}::text IS NOT NULL AND "fingerprintHash" = ${key.fingerprintHash}))
        ORDER BY "createdAt" DESC LIMIT ${limit}`);
      return rows.map(row => row.status);
    },
  };
}
