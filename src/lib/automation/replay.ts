import { Prisma } from '@prisma/client';
import type { EventPayload } from '@/lib/events';
import { builtinContext } from './context/builtins';
import { extractContextWithProvenance } from './context/extract';
import { compareAutomationOutcomes } from './comparison';
import { LIMITS, type CompiledSnapshot, type Context, type Route } from './contract';
import { evaluateAutomation, type Evaluation } from './evaluator';
import { evaluateConditions } from './evaluator/conditions';

export const REPLAY_MAX_EVENTS = 20_000;
export const REPLAY_MIN_DAYS = 7;
export const REPLAY_MAX_DAYS = 30;
export const REPLAY_BATCH_SIZE = 500;
const MAX_EXAMPLES = 10;
const MAX_TRANSITIONS = 10;
const MAX_TAGS = 20;

export const clampReplayDays = (days: number) =>
  Math.max(REPLAY_MIN_DAYS, Math.min(REPLAY_MAX_DAYS, Math.floor(days) || REPLAY_MIN_DAYS));

/** What Automation is given for one incident-opening event, minus the provider payload (never stored). */
export type ReplayEnvironment = {
  integrationType: string;
  defaultPolicyId: string | null;
  /** Base classification per alert severity, resolved once per replay. */
  classify: (severity: string) => { priority: string | null; urgency: string };
  /**
   * The intelligence fields as they stood at an event's time, rebuilt from stored evidence. Absent when no
   * rule reads them; the fields are then MISSING (unknown), exactly as live with the switch off.
   */
  intelligence?: (at: Date) => Context;
};

export type ReplayEvent = {
  incidentId: string;
  at: string;
  event: EventPayload;
  /** What actually happened when the event arrived. */
  actual: { route: Route; policyId: string | null; priority: string | null };
  /**
   * What people did afterwards, for the insight producers: the incident's priority now, and whether a person
   * changed its priority or team (`overriddenSoon`: within OVERRIDE_WINDOW_MINUTES of opening).
   */
  later?: { priority: string | null; priorityChanged: boolean; overriddenSoon: boolean };
};

/** "Responders keep overriding this rule": a change within this many minutes of the incident opening. */
export const OVERRIDE_WINDOW_MINUTES = 15;
/**
 * Timeline messages that record a person changing an incident's priority, urgency or team. Event writers
 * use these texts (incidents/actions.ts, rest-patch.ts, bulk-actions.ts, chatops-lifecycle.ts, assignment.ts).
 * shortcut: matched on message text because priority changes have no dedicated event type; add one if
 * these wordings ever change.
 */
export const PRIORITY_CHANGE_MESSAGES = Prisma.sql`(coalesce(e."type"::text, 'STATUS_CHANGE') = 'STATUS_CHANGE'
  AND (e."message" LIKE 'Priority updated%' OR e."message" LIKE 'Priority changed%'
    OR e."message" LIKE 'Priority cleared%' OR e."message" LIKE 'Bulk priority updated%'))`;
export const OVERRIDE_MESSAGES = Prisma.sql`(${PRIORITY_CHANGE_MESSAGES} OR e."type" = 'ASSIGNMENT'
  OR (coalesce(e."type"::text, 'STATUS_CHANGE') = 'STATUS_CHANGE'
    AND (e."message" LIKE 'Urgency updated%' OR e."message" LIKE 'Bulk urgency updated%')))`;

type Destination = { type: Route['type']; policyId: string | null };

export type ReplaySummary = {
  eventsEvaluated: number;
  same: number;
  routeChanged: number;
  priorityChanged: number;
  noEscalationChanged: number;
  /** Evaluations that threw; live traffic would fall back to the service default. */
  fallbacks: number;
  /** Evaluations slower than the live deadline. */
  overDeadline: number;
  /** No route rule matched, so the service default applied. */
  defaultRouted: number;
  unmappedEvents: number;
  unmappedFields: Record<string, number>;
  tagged: number;
  tags: Array<{ tag: string; count: number }>;
  /**
   * Every enabled rule in order; `matched: 0` is a rule that never matched. `shadowed` counts events a
   * route rule's conditions held for but an earlier route rule had already decided.
   */
  rules: Array<{
    ruleId: string;
    name: string;
    phase: 'ENRICH' | 'ROUTE';
    matched: number;
    shadowed: number;
  }>;
  transitions: Array<{ from: Destination; to: Destination; count: number }>;
  priorityTransitions: Array<{ from: string | null; to: string | null; count: number }>;
  evaluationMs: { p50: number; p99: number; max: number };
  examples: Array<{
    incidentId: string;
    at: string;
    from: Destination & { priority: string | null };
    to: Destination & { priority: string | null };
  }>;
};

/** The same context the ingestion runtime builds, with the normalized event standing in for the provider payload. */
export function replayContext(
  compiled: CompiledSnapshot,
  event: EventPayload,
  environment: ReplayEnvironment,
  at?: string
) {
  const extracted = extractContextWithProvenance({
    fields: compiled.fields,
    providerPayload: event,
    normalizedEvent: event,
    integrationType: environment.integrationType,
  });
  Object.assign(
    extracted.context,
    builtinContext({
      ...environment.classify(event.payload.severity),
      severity: event.payload.severity,
      integrationType: environment.integrationType,
      source: event.payload.source,
    })
  );
  if (environment.intelligence && at)
    Object.assign(extracted.context, environment.intelligence(new Date(at)));
  return extracted;
}

/** One event through the pure evaluator. Errors are returned, not thrown, as the runtime's fallback does. */
export function replayEvent(
  compiled: CompiledSnapshot,
  event: ReplayEvent,
  environment: ReplayEnvironment
): {
  result: Evaluation | null;
  unmapped: string[];
  error: string | null;
} {
  try {
    const { context, normalization } = replayContext(compiled, event.event, environment, event.at);
    return {
      result: evaluateAutomation({
        version: compiled,
        initialContext: context,
        evaluationAt: event.at,
      }),
      unmapped: normalization.filter(n => n.canonical.state === 'UNMAPPED').map(n => n.fieldKey),
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      unmapped: [],
      error: error instanceof Error ? error.message : 'EVALUATION_FAILED',
    };
  }
}

const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
const top = <T>(map: Map<string, number>, limit: number, decode: (key: string) => T) =>
  [...map]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([key, count]) => ({ ...decode(key), count }));

/** Folds evaluated events into a bounded summary; memory is O(rules + distinct destinations). */
export function createReplayAccumulator(
  compiled: CompiledSnapshot,
  environment: ReplayEnvironment
) {
  const rules = compiled.rules
    .filter(rule => rule.enabled)
    .map(rule => ({
      ruleId: rule.id,
      name: rule.name,
      phase: rule.phase,
      matched: 0,
      shadowed: 0,
    }));
  const routeRules = compiled.rules.filter(rule => rule.enabled && rule.phase === 'ROUTE');
  const ruleIndex = new Map(rules.map(rule => [rule.ruleId, rule]));
  const transitions = new Map<string, number>();
  const priorityTransitions = new Map<string, number>();
  const tags = new Map<string, number>();
  const unmappedFields = new Map<string, number>();
  const durations: number[] = [];
  const summary: ReplaySummary = {
    eventsEvaluated: 0,
    same: 0,
    routeChanged: 0,
    priorityChanged: 0,
    noEscalationChanged: 0,
    fallbacks: 0,
    overDeadline: 0,
    defaultRouted: 0,
    unmappedEvents: 0,
    unmappedFields: {},
    tagged: 0,
    tags: [],
    rules,
    transitions: [],
    priorityTransitions: [],
    evaluationMs: { p50: 0, p99: 0, max: 0 },
    examples: [],
  };
  return {
    add(event: ReplayEvent, evaluated: ReturnType<typeof replayEvent>, durationMs: number) {
      summary.eventsEvaluated += 1;
      durations.push(durationMs);
      if (durationMs > LIMITS.evaluationMs) summary.overDeadline += 1;
      const result = evaluated.result;
      if (!result) summary.fallbacks += 1;
      else {
        for (const rule of [...result.enrichmentRuleResults, ...result.routingRuleResults]) {
          const entry = rule.result === 'TRUE' ? ruleIndex.get(rule.ruleId) : undefined;
          if (entry) entry.matched += 1;
        }
        if (!result.matchedRule) summary.defaultRouted += 1;
        else {
          // Routing stops at the first match, so later rules are checked here, outside the timed path.
          const winner = routeRules.findIndex(rule => rule.id === result.matchedRule?.id);
          for (const rule of routeRules.slice(winner + 1)) {
            const entry = ruleIndex.get(rule.id);
            if (entry && evaluateConditions(result.enrichedContext, rule).result === 'TRUE')
              entry.shadowed += 1;
          }
        }
        if (result.tags.length) summary.tagged += 1;
        for (const tag of result.tags) bump(tags, tag);
      }
      if (evaluated.unmapped.length) summary.unmappedEvents += 1;
      for (const fieldKey of evaluated.unmapped) bump(unmappedFields, fieldKey);

      const hypothetical: Route = result?.outcome ?? { type: 'SERVICE_DEFAULT' };
      const priority = result?.enrichedContext.priority;
      // A fallback keeps the base priority, exactly as the runtime does.
      const hypotheticalPriority = !result
        ? environment.classify(event.event.payload.severity).priority
        : priority?.state === 'RECOGNIZED'
          ? String(priority.value)
          : null;
      const difference = compareAutomationOutcomes({
        actual: event.actual.route,
        hypothetical,
        defaultPolicyId: environment.defaultPolicyId,
        actualPolicyId: event.actual.policyId,
        actualPriority: event.actual.priority,
        hypotheticalPriority,
      });
      if (difference.same) {
        summary.same += 1;
        return;
      }
      const from: Destination = { type: event.actual.route.type, policyId: event.actual.policyId };
      const to: Destination = {
        type: hypothetical.type,
        policyId:
          hypothetical.type === 'ESCALATION_POLICY'
            ? hypothetical.policyId
            : hypothetical.type === 'NO_ESCALATION'
              ? null
              : environment.defaultPolicyId,
      };
      if (difference.routeDifferent) {
        summary.routeChanged += 1;
        bump(transitions, JSON.stringify([from, to]));
      }
      if (difference.noEscalationDifferent) summary.noEscalationChanged += 1;
      if (difference.priorityDifferent) {
        summary.priorityChanged += 1;
        bump(priorityTransitions, JSON.stringify([event.actual.priority, hypotheticalPriority]));
      }
      if (summary.examples.length < MAX_EXAMPLES)
        summary.examples.push({
          incidentId: event.incidentId,
          at: event.at,
          from: { ...from, priority: event.actual.priority },
          to: { ...to, priority: hypotheticalPriority },
        });
    },
    summary(): ReplaySummary {
      const sorted = [...durations].sort((a, b) => a - b);
      const at = (q: number) =>
        sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;
      return {
        ...summary,
        unmappedFields: Object.fromEntries(unmappedFields),
        tags: top(tags, MAX_TAGS, tag => ({ tag })),
        transitions: top(transitions, MAX_TRANSITIONS, key => {
          const [from, to] = JSON.parse(key) as [Destination, Destination];
          return { from, to };
        }),
        priorityTransitions: top(priorityTransitions, MAX_TRANSITIONS, key => {
          const [from, to] = JSON.parse(key) as [string | null, string | null];
          return { from, to };
        }),
        evaluationMs: { p50: at(0.5), p99: at(0.99), max: sorted.at(-1) ?? 0 },
      };
    },
  };
}

/** Pure replay of already-loaded events; the loader below feeds the same accumulator in batches. */
export function replayEvents(
  compiled: CompiledSnapshot,
  events: readonly ReplayEvent[],
  environment: ReplayEnvironment,
  clock: () => number = () => 0
): ReplaySummary {
  const accumulator = createReplayAccumulator(compiled, environment);
  for (const event of events) {
    const started = clock();
    const evaluated = replayEvent(compiled, event, environment);
    accumulator.add(event, evaluated, clock() - started);
  }
  return accumulator.summary();
}

type Row = {
  alertId: string;
  incidentId: string;
  createdAt: Date;
  dedupKey: string | null;
  payload: unknown;
  routeType: Route['type'] | null;
  decisionPolicyId: string | null;
  decisionPriority: string | null;
  hasDecision: boolean;
  currentPriority: string | null;
  priorityChanged: boolean;
  overriddenSoon: boolean;
};

const SEVERITIES = new Set(['critical', 'error', 'warning', 'info']);

function toReplayEvent(row: Row, environment: ReplayEnvironment): ReplayEvent | null {
  const payload = row.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object') return null;
  const severity = typeof payload.severity === 'string' ? payload.severity : '';
  if (!SEVERITIES.has(severity)) return null;
  const event: EventPayload = {
    event_action: 'trigger',
    dedup_key: row.dedupKey ?? row.alertId,
    payload: {
      summary: typeof payload.summary === 'string' ? payload.summary : '',
      source: typeof payload.source === 'string' ? payload.source : '',
      severity: severity as EventPayload['payload']['severity'],
      custom_details: payload.custom_details,
    },
  };
  const route: Route =
    row.routeType === 'NO_ESCALATION'
      ? { type: 'NO_ESCALATION' }
      : row.routeType === 'ESCALATION_POLICY' && row.decisionPolicyId
        ? { type: 'ESCALATION_POLICY', policyId: row.decisionPolicyId }
        : { type: 'SERVICE_DEFAULT' };
  return {
    incidentId: row.incidentId,
    at: row.createdAt.toISOString(),
    event,
    // Without a LIVE decision the incident took the service default at its base priority.
    actual: row.hasDecision
      ? { route, policyId: row.decisionPolicyId, priority: row.decisionPriority }
      : {
          route,
          policyId: environment.defaultPolicyId,
          priority: environment.classify(severity).priority,
        },
    later: {
      priority: row.currentPriority,
      priorityChanged: row.priorityChanged,
      overriddenSoon: row.overriddenSoon,
    },
  };
}

export type ReplayProgress = { scanned: number; evaluated: number; fraction: number };

/** A non-global reader's incident scope (see `incidentReadWhereParts`). */
export type ReplayIncidentScope = { actorId: string; teamIds: string[] };

/** SQL mirror of `incidentReadWhere` for a scoped reader: assigned, watched, or PUBLIC on one of their teams. */
function incidentScopeSql(scope: ReplayIncidentScope): Prisma.Sql {
  const teams = scope.teamIds.length
    ? Prisma.sql`(i."visibility" = 'PUBLIC' AND (i."teamId" IN (${Prisma.join(scope.teamIds)})
        OR EXISTS (SELECT 1 FROM "Service" s WHERE s."id" = i."serviceId"
          AND s."teamId" IN (${Prisma.join(scope.teamIds)}))))`
    : Prisma.sql`FALSE`;
  return Prisma.sql`AND (i."assigneeId" = ${scope.actorId}
    OR EXISTS (SELECT 1 FROM "IncidentWatcher" w WHERE w."incidentId" = i."id" AND w."userId" = ${scope.actorId})
    OR ${teams})`;
}

/**
 * Replays `compiled` over the service's stored incident-opening alerts in the window: keyset pages on
 * the (serviceId, createdAt) index, at most REPLAY_MAX_EVENTS rows, one bounded query per page.
 * `run` supplies the transaction for each page so the caller chooses the statement budget.
 */
export async function replayStoredEvents(input: {
  compiled: CompiledSnapshot;
  serviceId: string;
  environment: ReplayEnvironment;
  windowStart: Date;
  windowEnd: Date;
  /** Limits the replay to incidents this requester can read; null or absent reads every incident. */
  incidentScope?: ReplayIncidentScope | null;
  run: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  onProgress?: (progress: ReplayProgress) => Promise<void>;
  /** Sees every evaluated event, for callers that aggregate more than the summary holds. */
  onEvent?: (event: ReplayEvent, evaluated: ReturnType<typeof replayEvent>) => void;
  batchSize?: number;
  maxEvents?: number;
}): Promise<ReplaySummary & { alertsScanned: number; truncated: boolean }> {
  const batchSize = input.batchSize ?? REPLAY_BATCH_SIZE;
  const maxEvents = input.maxEvents ?? REPLAY_MAX_EVENTS;
  const accumulator = createReplayAccumulator(input.compiled, input.environment);
  const span = Math.max(1, input.windowEnd.getTime() - input.windowStart.getTime());
  const visible = input.incidentScope ? incidentScopeSql(input.incidentScope) : Prisma.empty;
  let cursor: { createdAt: Date; id: string } | null = null;
  let scanned = 0;
  let evaluated = 0;
  let truncated = false;
  for (;;) {
    const take = Math.min(batchSize, maxEvents - scanned);
    if (take <= 0) {
      truncated = true;
      break;
    }
    const after: { createdAt: Date; id: string } | null = cursor;
    // The first alert of an incident created in the window is the event that opened it.
    const rows: Row[] = await input.run(
      tx =>
        tx.$queryRaw<Row[]>`
        SELECT a."id" AS "alertId", a."incidentId", a."createdAt", a."dedupKey", a."payload",
               d."routeType"::text AS "routeType", d."escalationPolicyId" AS "decisionPolicyId",
               d."finalPriority" AS "decisionPriority", (d."incidentId" IS NOT NULL) AS "hasDecision",
               i."priority" AS "currentPriority",
               EXISTS (SELECT 1 FROM "IncidentEvent" e WHERE e."incidentId" = i."id"
                 AND ${PRIORITY_CHANGE_MESSAGES}) AS "priorityChanged",
               EXISTS (SELECT 1 FROM "IncidentEvent" e WHERE e."incidentId" = i."id"
                 AND e."createdAt" <= i."createdAt" + ${OVERRIDE_WINDOW_MINUTES}::int * interval '1 minute'
                 AND ${OVERRIDE_MESSAGES}) AS "overriddenSoon"
        FROM "Alert" a
        JOIN "Incident" i ON i."id" = a."incidentId"
        LEFT JOIN "IncidentAutomationDecision" d ON d."incidentId" = i."id"
        WHERE a."serviceId" = ${input.serviceId}
          AND a."createdAt" >= ${input.windowStart} AND a."createdAt" <= ${input.windowEnd}
          AND a."status" = 'TRIGGERED'
          AND i."createdAt" >= ${input.windowStart}
          ${visible}
          AND NOT EXISTS (
            SELECT 1 FROM "Alert" earlier
            WHERE earlier."incidentId" = a."incidentId"
              AND (earlier."createdAt", earlier."id") < (a."createdAt", a."id")
          )
          ${after ? Prisma.sql`AND (a."createdAt", a."id") > (${after.createdAt}, ${after.id})` : Prisma.empty}
        ORDER BY a."createdAt" ASC, a."id" ASC
        LIMIT ${take}`
    );
    for (const row of rows) {
      const event = toReplayEvent(row, input.environment);
      if (!event) continue;
      const started = performance.now();
      const result = replayEvent(input.compiled, event, input.environment);
      accumulator.add(event, result, performance.now() - started);
      input.onEvent?.(event, result);
      evaluated += 1;
    }
    scanned += rows.length;
    const last = rows.at(-1);
    if (!last || rows.length < take) break;
    cursor = { createdAt: last.createdAt, id: last.alertId };
    await input.onProgress?.({
      scanned,
      evaluated,
      fraction: Math.min(1, (last.createdAt.getTime() - input.windowStart.getTime()) / span),
    });
  }
  return { ...accumulator.summary(), alertsScanned: scanned, truncated };
}
