import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { loadActiveEdges } from '../dependencies/service';
import { topologyScope } from '../dependencies/graph';
import {
  GLOBAL_NOISE_SCOPE_KEY,
  PREPAGING_LIMITS,
  noiseControlDefinitionSchema,
  type Matcher,
  type NoiseControlDefinition,
} from './contract';
import { compileMatcher } from './matchers';
import { warmNoiseLookupClient } from './lookup-client';
import { loadServiceSignals } from '@/lib/automation/intelligence-signals';
import {
  EMPTY_SIGNALS,
  inMaintenanceAt,
  intelligenceContext,
  type ServiceSignals,
} from '@/lib/automation/context/intelligence';
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
/**
 * A storm parent is open, and is not itself a storm child that was never paged (the cascade pages those
 * once their parent resolves): grouping under one would leave the new child silent too.
 */
const STORM_PARENT_ELIGIBLE = `AND "status" IN ('OPEN', 'ACKNOWLEDGED')
          AND NOT EXISTS (
            SELECT 1 FROM "IncidentRelationship" r
            WHERE r."sourceIncidentId" = "Incident"."id" AND r."type" = 'PARENT_CHILD'
              AND r."evidence"->>'kind' = 'prepaging_storm'
              AND "Incident"."status" = 'OPEN' AND "Incident"."escalationStatus" = 'COMPLETED'
          )`;

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
  activeVersionId?: string | null;
  activeVersion?: { policyRevision: number } | null;
  pipelineOrder?: 'OFF' | 'SHADOW' | 'ON' | null;
}): CompiledPolicy {
  const definition = parseDefinition(row.definition);
  return {
    scopeKey: row.scopeKey,
    serviceId: row.serviceId,
    mode: row.mode,
    pipelineOrder: row.mode === 'OFF' ? 'OFF' : (row.pipelineOrder ?? 'OFF'),
    revision: row.revision,
    // Only a version published at this exact revision describes what is running; a stale pointer (a row
    // rewritten by a replica that predates versioning) yields null until the backfill captures it.
    versionId:
      row.activeVersionId && row.activeVersion?.policyRevision === row.revision
        ? row.activeVersionId
        : null,
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

/**
 * Evidence for the automation intelligence fields, only while that switch (and Intelligence) is on. Any
 * failure leaves it null: automation then reads the fields as unknown, the rest of the snapshot is kept.
 */
async function loadAutomationSignals(
  client: Client,
  now: Date
): Promise<Map<string, ServiceSignals> | null> {
  try {
    const settings = await client.intelligenceSettings.findUnique({
      where: { id: 'default' },
      select: { enabled: true, automationIntelligenceFieldsEnabled: true },
    });
    if (!settings?.enabled || !settings.automationIntelligenceFieldsEnabled) return null;
    return await loadServiceSignals(client, { from: now, to: now });
  } catch (error) {
    logger.debug('[Intelligence] Automation signals unavailable; fields read as unknown', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function loadPrePagingSnapshot(
  client: Client = prisma,
  now: Date = new Date()
): Promise<PrePagingSnapshot> {
  const horizon = new Date(now.getTime() + WINDOW_HORIZON_MS);
  const [policies, windows, rules] = await Promise.all([
    client.noiseControlPolicy.findMany({
      where: { mode: { not: 'OFF' } },
      include: { activeVersion: { select: { policyRevision: true } } },
    }),
    client.noiseMaintenanceWindow.findMany({
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
  // A service switched OFF must not inherit an active global policy, so its OFF row is kept as an
  // explicit override. Only loaded when a global policy is active; otherwise OFF rows are irrelevant.
  if (compiledPolicies.has(GLOBAL_NOISE_SCOPE_KEY)) {
    const overrides = await client.noiseControlPolicy.findMany({
      where: { mode: 'OFF', serviceId: { not: null } },
      select: { scopeKey: true, serviceId: true, revision: true },
      take: 20_000,
    });
    for (const row of overrides)
      compiledPolicies.set(
        row.scopeKey,
        compilePolicy({ ...row, mode: 'OFF', definition: { schemaVersion: 1 } })
      );
  }
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
    serviceSignals: await loadAutomationSignals(client, now),
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

/**
 * The automation intelligence fields for one service, from the snapshot alone (no query, no await).
 * Cold snapshot or switch off → every field MISSING (unknown).
 */
export function automationIntelligenceContext(serviceId: string, at: Date) {
  const snapshot = getPrePagingSnapshot();
  const signals = snapshot?.serviceSignals;
  if (!snapshot || !signals) return intelligenceContext({ signals: null, inMaintenance: null, at });
  return intelligenceContext({
    signals: signals.get(serviceId) ?? EMPTY_SIGNALS,
    inMaintenance: inMaintenanceAt(
      snapshot.windows,
      { serviceId, teamId: snapshot.serviceTeams.get(serviceId) ?? null },
      at
    ),
    at,
  });
}

/** The snapshot as it is right now. Starts no load: only the hook itself decides when to refresh. */
export function peekPrePagingSnapshot(): PrePagingSnapshot | null {
  return current;
}

/** Single-flight refresh. Failures keep the previous snapshot and are logged at debug level. */
export function refreshPrePagingSnapshot(): Promise<PrePagingSnapshot | null> {
  if (loading) return loading;
  loading = loadPrePagingSnapshot()
    .then(snapshot => {
      current = snapshot;
      if (needsLookups(snapshot)) void warmNoiseLookupClient(warmLookupStatement);
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

/** Whether any policy can make the hook read (SHADOW or ON). */
function needsLookups(snapshot: PrePagingSnapshot): boolean {
  return [...snapshot.policies.values()].some(policy => policy.mode !== 'OFF');
}

/** Awaits a fresh snapshot (and the lookup pool it needs): for process start and tests. */
export async function primePrePagingSnapshot(): Promise<PrePagingSnapshot | null> {
  current = null;
  const snapshot = await refreshPrePagingSnapshot();
  if (snapshot && needsLookups(snapshot)) await warmNoiseLookupClient(warmLookupStatement);
  return snapshot;
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
    async findStormParent(serviceIds, since, preferServiceId) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        (SELECT "id" FROM "Incident"
        WHERE "serviceId" = ${preferServiceId ?? null}::text AND "createdAt" >= ${since}
          ${Prisma.raw(STORM_PARENT_ELIGIBLE)}
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
        UNION ALL
        (SELECT "id" FROM "Incident"
        WHERE "serviceId" = ANY(${[...serviceIds]}::text[]) AND "createdAt" >= ${since}
          ${Prisma.raw(STORM_PARENT_ELIGIBLE)}
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
        LIMIT 1`);
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

/** The exact reads the evaluator will make for one alert, derived from the policy before it runs. */
export interface PrePagingLookupPlan {
  serviceId: string;
  dedup: { fingerprintHash: string; since: Date } | null;
  flapping: { dedupKey: string; fingerprintHash: string | null; since: Date; limit: number } | null;
  storm: { serviceIds: readonly string[]; since: Date } | null;
}

/** The prefetch statement with every lookup, matching nothing: warms a fresh pool connection. */
function warmLookupStatement(client: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const since = new Date();
  return prefetchedLookups(client, {
    serviceId: '',
    dedup: { fingerprintHash: '', since },
    flapping: { dedupKey: '', fingerprintHash: null, since, limit: 1 },
    storm: { serviceIds: [''], since },
  }).findOpenIncidentByFingerprint('', '', since);
}

interface PrefetchedRow {
  dedup: { id: string; labels: unknown } | null;
  statuses: string[] | null;
  stormCount: bigint | number | null;
  stormParent: string | null;
}

/** One lookup of the combined statement: its text split around the parameters, in order. */
const DEDUP_PART = [
  `(SELECT json_build_object('id', i."id", 'labels', f."labels") FROM "Alert" a
        JOIN "Incident" i ON i."id" = a."incidentId"
        LEFT JOIN "IncidentFingerprint" f ON f."incidentId" = i."id"
        WHERE a."serviceId" = `,
  ` AND a."fingerprintHash" = `,
  `
          AND a."createdAt" >= `,
  `
          AND i."status" IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED')
        ORDER BY a."createdAt" DESC LIMIT 1)`,
] as const;
const STATUSES_PART = [
  `(SELECT coalesce(json_agg(s."status" ORDER BY s."createdAt" DESC), '[]'::json) FROM (
        SELECT "status", "createdAt" FROM "Alert"
        WHERE "serviceId" = `,
  ` AND "createdAt" >= `,
  `
          AND ("dedupKey" = `,
  ` OR (`,
  `::text IS NOT NULL AND "fingerprintHash" = `,
  `))
        ORDER BY "createdAt" DESC LIMIT `,
  `) s)`,
] as const;
const STORM_COUNT_PART = [
  `(SELECT count(*) FROM "Incident"
        WHERE "serviceId" = ANY(`,
  `::text[]) AND "createdAt" >= `,
  `)`,
] as const;
const STORM_PARENT_PART = [
  `(SELECT "id" FROM (
        (SELECT "id" FROM "Incident"
        WHERE "serviceId" = `,
  `::text AND "createdAt" >= `,
  `
          ${STORM_PARENT_ELIGIBLE}
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
        UNION ALL
        (SELECT "id" FROM "Incident"
        WHERE "serviceId" = ANY(`,
  `::text[]) AND "createdAt" >= `,
  `
          ${STORM_PARENT_ELIGIBLE}
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)) parent LIMIT 1)`,
] as const;
const NULL_PART = ['NULL'] as const;

/** The statement text for each combination of enabled lookups, built once: it never depends on values. */
const statementTexts = new Map<number, readonly string[]>();
function statementText(dedup: boolean, flapping: boolean, storm: boolean): readonly string[] {
  const key = (dedup ? 1 : 0) | (flapping ? 2 : 0) | (storm ? 4 : 0);
  let text = statementTexts.get(key);
  if (!text) {
    const strings = ['SELECT '];
    const append = (part: readonly string[], alias: string) => {
      strings[strings.length - 1] += part[0];
      strings.push(...part.slice(1));
      strings[strings.length - 1] += alias;
    };
    append(dedup ? DEDUP_PART : NULL_PART, ' AS "dedup", ');
    append(flapping ? STATUSES_PART : NULL_PART, ' AS "statuses", ');
    append(storm ? STORM_COUNT_PART : NULL_PART, ' AS "stormCount", ');
    append(storm ? STORM_PARENT_PART : NULL_PART, ' AS "stormParent"');
    text = strings;
    statementTexts.set(key, text);
  }
  return text;
}

/**
 * The combined lookup statement for a plan. Text and parameter order are fixed per combination of
 * enabled lookups, so an event only fills in its values (composing nested fragments per event showed up
 * in the ingestion CPU profile).
 */
export function prefetchStatement(plan: PrePagingLookupPlan): Prisma.Sql {
  const values: unknown[] = [];
  if (plan.dedup) values.push(plan.serviceId, plan.dedup.fingerprintHash, plan.dedup.since);
  if (plan.flapping)
    values.push(
      plan.serviceId,
      plan.flapping.since,
      plan.flapping.dedupKey,
      plan.flapping.fingerprintHash,
      plan.flapping.fingerprintHash,
      plan.flapping.limit
    );
  if (plan.storm) {
    const serviceIds = [...plan.storm.serviceIds];
    values.push(
      serviceIds,
      plan.storm.since,
      plan.serviceId,
      plan.storm.since,
      serviceIds,
      plan.storm.since
    );
  }
  // The tag accepts any string list; called directly it does exactly what a template literal would.
  const text = statementText(!!plan.dedup, !!plan.flapping, !!plan.storm);
  return Prisma.sql(text as unknown as TemplateStringsArray, ...values);
}

function labelsOf(raw: unknown): Record<string, string> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    : null;
}

/**
 * The same index-backed reads as `prismaLookups`, fetched in ONE round trip on first use and served from
 * memory afterwards. A call whose arguments differ from the plan falls back to its own query, so the
 * answers are always exactly what `prismaLookups` would return. `start()` sends the statement ahead of
 * first use (see `beginIngestNoiseLookups`).
 */
export function prefetchedLookups(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  plan: PrePagingLookupPlan
): PrePagingLookups & { start(): void } {
  const base = prismaLookups(tx);
  let fetched: Promise<PrefetchedRow> | null = null;
  const prefetch = () =>
    (fetched ??= tx.$queryRaw<PrefetchedRow[]>(prefetchStatement(plan)).then(rows => rows[0]));
  const sameScope = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id, index) => id === b.at(index));
  return {
    /** Sends the statement now instead of on first use. A failure surfaces on the lookup that reads it. */
    start() {
      prefetch().catch(() => undefined);
    },
    async findOpenIncidentByFingerprint(serviceId, fingerprintHash, since) {
      const planned = plan.dedup;
      if (
        !planned ||
        serviceId !== plan.serviceId ||
        fingerprintHash !== planned.fingerprintHash ||
        since.getTime() !== planned.since.getTime()
      )
        return base.findOpenIncidentByFingerprint(serviceId, fingerprintHash, since);
      const row = (await prefetch()).dedup;
      return row ? { id: row.id, labels: labelsOf(row.labels) } : null;
    },
    async recentAlertStatuses(serviceId, key, since, limit) {
      const planned = plan.flapping;
      if (
        !planned ||
        serviceId !== plan.serviceId ||
        key.dedupKey !== planned.dedupKey ||
        key.fingerprintHash !== planned.fingerprintHash ||
        since.getTime() !== planned.since.getTime() ||
        limit !== planned.limit
      )
        return base.recentAlertStatuses(serviceId, key, since, limit);
      return (await prefetch()).statuses ?? [];
    },
    async countRecentIncidents(serviceIds, since) {
      const planned = plan.storm;
      if (
        !planned ||
        !sameScope(serviceIds, planned.serviceIds) ||
        since.getTime() !== planned.since.getTime()
      )
        return base.countRecentIncidents(serviceIds, since);
      return Number((await prefetch()).stormCount ?? 0);
    },
    async findStormParent(serviceIds, since, preferServiceId) {
      const planned = plan.storm;
      if (
        !planned ||
        !sameScope(serviceIds, planned.serviceIds) ||
        since.getTime() !== planned.since.getTime() ||
        (preferServiceId !== undefined && preferServiceId !== plan.serviceId)
      )
        return base.findStormParent(serviceIds, since, preferServiceId);
      const id = (await prefetch()).stormParent;
      return id ? { id } : null;
    },
  };
}
