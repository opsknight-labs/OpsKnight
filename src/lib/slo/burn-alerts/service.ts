import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { ConnectorError, type ConnectorFetch } from '@/lib/intelligence/connectors/http';
import { CONNECTOR_ADAPTERS } from '@/lib/intelligence/connectors/adapters';
import { contextFor, loadConnectionForLane } from '@/lib/intelligence/connectors/service';
import { withDbBudget } from '@/lib/intelligence/jobs/db-budget';
import { enqueueWorkItems, WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import { connectionScopeProblem } from '@/lib/intelligence/metric-anomaly/service';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import type { ObjectiveActor } from '../commands';
import {
  SLO_ALERT_BOUNDS,
  SLO_ALERT_STATUS,
  SLO_ALERTABLE_METRICS,
  SLO_BURN_TIERS,
  isSloAlertState,
  sloAlertPolicyInputSchema,
  type SloAlertPolicyView,
  type SloBurnByWindow,
  type SloBurnHistory,
} from './contract';
import { burnOf, joinSli, sumByBucket, type SliPoint } from './tiers';
import type { SloSeriesFetcher } from './evaluate';

type Client = Prisma.TransactionClient | typeof prisma;
const MINUTE = 60_000;

const SELECT = {
  lineageId: true,
  serviceId: true,
  connectionId: true,
  goodQuery: true,
  totalQuery: true,
  stepSeconds: true,
  enabled: true,
  ticketsEnabled: true,
  state: true,
  stateSince: true,
  lastEvaluatedAt: true,
  lastStatus: true,
  lastIncidentId: true,
  coverageFrom: true,
  updatedAt: true,
  connection: { select: { name: true } },
} as const;
type Row = Prisma.SloAlertPolicyGetPayload<{ select: typeof SELECT }>;

function toView(row: Row): SloAlertPolicyView {
  return {
    objectiveId: row.lineageId,
    serviceId: row.serviceId,
    connectionId: row.connectionId,
    connectionName: row.connection?.name ?? null,
    goodQuery: row.goodQuery,
    totalQuery: row.totalQuery,
    stepSeconds: row.stepSeconds,
    enabled: row.enabled,
    ticketsEnabled: row.ticketsEnabled,
    state: isSloAlertState(row.state) ? row.state : 'OK',
    stateSince: row.stateSince.toISOString(),
    lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    lastIncidentId: row.lastIncidentId,
    coverageFrom: row.coverageFrom?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SCOPE_MESSAGES = new Map<string, string>([
  [SLO_ALERT_STATUS.NO_CONNECTION, 'That connection no longer exists'],
  [SLO_ALERT_STATUS.CONNECTION_DISABLED, 'Enable the connection first'],
  [SLO_ALERT_STATUS.UNSUPPORTED, 'That connection cannot answer metric queries'],
  [
    SLO_ALERT_STATUS.CONNECTION_NOT_ALLOWED,
    "That connection is not allowed for this service's team",
  ],
]);
const scopeMessage = (problem: string) =>
  SCOPE_MESSAGES.get(problem) ?? 'That connection cannot be used';

function invalid(field: string, message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', fields: [{ field, code: 'custom', message }] });
}

/** The active objective a policy can attach to: a service availability or uptime objective. */
async function alertableObjective(client: Client, lineageId: string) {
  const objective = await client.serviceObjective.findFirst({
    where: { lineageId, activeTo: null },
    select: {
      lineageId: true,
      name: true,
      target: true,
      metricType: true,
      serviceId: true,
      service: { select: { teamId: true } },
    },
  });
  if (!objective) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  if (!objective.serviceId || !objective.service)
    throw invalid('objective', 'Burn-rate alerts need an objective that belongs to a service');
  if (!(SLO_ALERTABLE_METRICS as readonly string[]).includes(objective.metricType))
    throw invalid('objective', 'Burn-rate alerts measure availability and uptime objectives only');
  return { ...objective, serviceId: objective.serviceId, service: objective.service };
}

async function checkConnection(client: Client, connectionId: string, teamId: string | null) {
  const connection = await client.observabilityConnection.findUnique({
    where: { id: connectionId },
    select: { enabled: true, kind: true, allowedTeamIds: true },
  });
  const problem = connectionScopeProblem(connection, { teamId });
  if (problem) throw invalid('connectionId', scopeMessage(problem));
}

/** Why an objective cannot carry a policy, or null when it can. For the settings form. */
export async function sloAlertEligibility(lineageId: string, client: Client = prisma) {
  try {
    await alertableObjective(client, lineageId);
    return null;
  } catch (error) {
    if (error instanceof AppError) return error.fields?.[0]?.message ?? error.userMessage;
    throw error;
  }
}

/** Connections a policy on this objective may use: enabled, metric-capable and open to the service team. */
export async function listSloAlertConnections(lineageId: string, client: Client = prisma) {
  const objective = await alertableObjective(client, lineageId);
  const rows = await client.observabilityConnection.findMany({
    where: { enabled: true },
    orderBy: { name: 'asc' },
    take: 200,
    select: { id: true, name: true, kind: true, enabled: true, allowedTeamIds: true },
  });
  return rows
    .filter(row => connectionScopeProblem(row, { teamId: objective.service.teamId }) === null)
    .map(row => ({ id: row.id, name: row.name }));
}

export async function getSloAlertPolicy(
  lineageId: string,
  client: Client = prisma
): Promise<SloAlertPolicyView | null> {
  const row = await client.sloAlertPolicy.findUnique({ where: { lineageId }, select: SELECT });
  return row ? toView(row) : null;
}

/**
 * Creates or replaces the policy of an objective. Caller must authorize SERVICE_OBJECTIVE_MANAGE. Saving does
 * no network I/O. A changed connection or query discards the stored measurements, so the tiers re-arm only
 * as fresh coverage builds up; the alert state is kept and steps down through clean evaluations as usual.
 */
export async function saveSloAlertPolicy(
  tx: Prisma.TransactionClient,
  lineageId: string,
  input: unknown,
  actor: ObjectiveActor
): Promise<SloAlertPolicyView> {
  const parsed = sloAlertPolicyInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: parsed.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        code: issue.code,
        message: issue.message,
      })),
    });
  const data = parsed.data;
  const objective = await alertableObjective(tx, lineageId);
  await checkConnection(tx, data.connectionId, objective.service.teamId);

  const existing = await tx.sloAlertPolicy.findUnique({ where: { lineageId }, select: SELECT });
  const remeasure =
    !existing ||
    existing.connectionId !== data.connectionId ||
    existing.goodQuery !== data.goodQuery ||
    existing.totalQuery !== data.totalQuery;
  const row = existing
    ? await tx.sloAlertPolicy.update({
        where: { lineageId },
        data: {
          ...data,
          serviceId: objective.serviceId,
          updatedById: actor.id,
          ...(remeasure ? { coverageFrom: null, belowStreak: 0, lastEvaluatedAt: null } : {}),
        },
        select: { ...SELECT, id: true },
      })
    : await tx.sloAlertPolicy.create({
        data: {
          ...data,
          lineageId,
          serviceId: objective.serviceId,
          stepSeconds: SLO_ALERT_BOUNDS.stepSeconds,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { ...SELECT, id: true },
      });
  if (existing && remeasure) await tx.sloSliPoint.deleteMany({ where: { policyId: row.id } });
  const view = toView(row);
  const audited = (value: SloAlertPolicyView) => ({
    connectionId: value.connectionId,
    goodQuery: value.goodQuery,
    totalQuery: value.totalQuery,
    enabled: value.enabled,
    ticketsEnabled: value.ticketsEnabled,
  });
  await emitAuditEvent(
    {
      action: existing
        ? 'service_objective.alert_policy.updated'
        : 'service_objective.alert_policy.created',
      source: actor.source,
      actor: { type: 'USER', id: actor.id },
      target: { type: 'SERVICE', id: objective.serviceId },
      ...(existing ? { oldValue: audited(toView(existing)) } : {}),
      newValue: audited(view),
      metadata: {
        lineageId,
        ...(actor.source === 'API' ? { apiClientId: actor.apiClientId } : {}),
      },
    },
    tx
  );
  return view;
}

export type SloQueryTestResult =
  | {
      ok: true;
      good: number;
      total: number;
      /** Good / total over the last hour, as a percentage; null without events. */
      sli: number | null;
      burn1h: number | null;
      steps: number;
    }
  | { ok: false; status: string; message: string };

/**
 * Runs both queries over the last hour against the chosen connection and reports the SLI and burn they
 * imply, without saving anything. Caller must authorize SERVICE_OBJECTIVE_MANAGE.
 */
export async function testSloAlertQueries(
  lineageId: string,
  input: unknown,
  options: { fetch?: ConnectorFetch; fetchSeries?: SloSeriesFetcher; now?: Date } = {}
): Promise<SloQueryTestResult> {
  const parsed = sloAlertPolicyInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, status: 'INVALID', message: 'Choose a connection and enter both queries.' };
  let objective;
  try {
    objective = await alertableObjective(prisma, lineageId);
  } catch (error) {
    if (error instanceof AppError)
      return {
        ok: false,
        status: 'INVALID',
        message: error.fields?.[0]?.message ?? error.userMessage,
      };
    throw error;
  }
  const lane = await loadConnectionForLane(parsed.data.connectionId);
  const problem = connectionScopeProblem(
    lane
      ? { enabled: lane.enabled, kind: lane.connection.kind, allowedTeamIds: lane.allowedTeamIds }
      : null,
    objective.service
  );
  if (problem || !lane)
    return {
      ok: false,
      status: problem ?? SLO_ALERT_STATUS.NO_CONNECTION,
      message: scopeMessage(problem ?? SLO_ALERT_STATUS.NO_CONNECTION),
    };
  const stepSeconds = SLO_ALERT_BOUNDS.stepSeconds;
  const stepMs = stepSeconds * 1000;
  const now = options.now ?? new Date();
  const end = Math.floor((now.getTime() - SLO_ALERT_BOUNDS.settleSeconds * 1000) / stepMs) * stepMs;
  const from = end - 60 * MINUTE;
  const window = { start: new Date(from + stepMs), end: new Date(end) };
  const fetchSeries: SloSeriesFetcher =
    options.fetchSeries ??
    (async (connection, query, signal) => {
      const adapter = CONNECTOR_ADAPTERS[connection.kind];
      if (!adapter?.series) throw new ConnectorError('UNSUPPORTED', 'No metric queries');
      return adapter.series(contextFor(connection, { fetch: options.fetch, signal }), query);
    });
  const signal = AbortSignal.timeout(SLO_ALERT_BOUNDS.evaluationBudgetMs / 2);
  let points: SliPoint[];
  try {
    const [good, total] = await Promise.all([
      fetchSeries(lane.connection, { query: parsed.data.goodQuery, window, stepSeconds }, signal),
      fetchSeries(lane.connection, { query: parsed.data.totalQuery, window, stepSeconds }, signal),
    ]);
    points = joinSli(sumByBucket(good, stepMs, from, end), sumByBucket(total, stepMs, from, end));
  } catch (error) {
    const code = error instanceof ConnectorError ? error.code : 'FAILED';
    return {
      ok: false,
      status: `${SLO_ALERT_STATUS.CONNECTOR_ERROR}:${code}`,
      message: `The connection could not answer the queries (${code}).`,
    };
  }
  const good = points.reduce((sum, point) => sum + point.good, 0);
  const total = points.reduce((sum, point) => sum + point.total, 0);
  return {
    ok: true,
    good,
    total,
    sli: total > 0 ? Math.round((good / total) * 1e6) / 1e4 : null,
    burn1h: burnOf(good, total, objective.target),
    steps: points.length,
  };
}

/**
 * Enqueues one EVALUATE_SLO_POLICY item per policy due for its next step, oldest first, at most
 * scheduleBatch per check. A policy switched off while still alerting stays due once, so it can close
 * its incident. While no policy is enabled this is one small index probe.
 */
export async function scheduleSloEvaluationsIfDue(
  settings: { maxDbMs: number },
  now: Date = new Date()
): Promise<number> {
  if (!(await getIntelligenceSettings()).enabled) return 0;
  const due = await withDbBudget(settings, tx =>
    tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "SloAlertPolicy"
      WHERE ("enabled" = true OR "state" <> 'OK')
        AND ("lastEvaluatedAt" IS NULL
          OR "lastEvaluatedAt" <= ${now}::timestamp - ("stepSeconds" * interval '1 second'))
      ORDER BY "lastEvaluatedAt" ASC NULLS FIRST, "id" ASC
      LIMIT ${SLO_ALERT_BOUNDS.scheduleBatch}`)
  );
  if (due.length === 0) return 0;
  return enqueueWorkItems(
    due.map(row => ({ kind: WORK_KINDS.EVALUATE_SLO_POLICY, subjectKey: row.id }))
  );
}

/** Stored steps for the chart: SLI per step and the burn over the hour ending at each step. */
export async function getSloBurnHistory(
  lineageId: string,
  hours: number,
  now: Date = new Date(),
  client: Client = prisma
): Promise<SloBurnHistory | null> {
  const policy = await client.sloAlertPolicy.findUnique({
    where: { lineageId },
    select: { id: true, state: true, stepSeconds: true },
  });
  if (!policy) return null;
  const objective = await client.serviceObjective.findFirst({
    where: { lineageId },
    orderBy: { version: 'desc' },
    select: { target: true },
  });
  const span = Math.min(Math.max(1, Math.floor(hours)), SLO_ALERT_BOUNDS.historyMaxHours);
  const start = now.getTime() - span * 60 * MINUTE;
  // One extra hour so the first step already has a full hour of burn behind it.
  const [rows, transitions] = await Promise.all([
    client.sloSliPoint.findMany({
      where: { policyId: policy.id, bucketStart: { gte: new Date(start - 60 * MINUTE) } },
      orderBy: { bucketStart: 'asc' },
      select: { bucketStart: true, good: true, total: true },
    }),
    client.sloAlertTransition.findMany({
      where: { policyId: policy.id, at: { gte: new Date(start) } },
      orderBy: { at: 'desc' },
      take: SLO_ALERT_BOUNDS.maxTransitions,
      select: { from: true, to: true, at: true, incidentId: true, burnByWindow: true },
    }),
  ]);
  const target = objective?.target ?? 99.9;
  const points: SloBurnHistory['points'] = [];
  let windowGood = 0;
  let windowTotal = 0;
  let tail = 0;
  for (const row of rows) {
    const at = row.bucketStart.getTime();
    windowGood += row.good;
    windowTotal += row.total;
    // Drop the steps that left the trailing hour; the current row always stays, so this stops in bounds.
    for (let head = rows.at(tail); head && head.bucketStart.getTime() <= at - 60 * MINUTE;) {
      windowGood -= head.good;
      windowTotal -= head.total;
      tail += 1;
      head = rows.at(tail);
    }
    if (at < start) continue;
    points.push({
      at: row.bucketStart.toISOString(),
      good: row.good,
      total: row.total,
      sli: row.total > 0 ? Math.round((row.good / row.total) * 1e6) / 1e4 : null,
      burn1h: burnOf(windowGood, windowTotal, target),
    });
  }
  return {
    objectiveId: lineageId,
    targetPercent: target,
    state: isSloAlertState(policy.state) ? policy.state : 'OK',
    hours: span,
    points,
    transitions: transitions.reverse().map(item => ({
      from: isSloAlertState(item.from) ? item.from : 'OK',
      to: isSloAlertState(item.to) ? item.to : 'OK',
      at: item.at.toISOString(),
      incidentId: item.incidentId,
      burnByWindow: item.burnByWindow as SloBurnByWindow,
    })),
    tiers: SLO_BURN_TIERS,
  };
}

/** Alert state of every policy on a service, for the service page badge. */
export async function listServiceSloAlerts(serviceId: string, client: Client = prisma) {
  const rows = await client.sloAlertPolicy.findMany({
    where: { serviceId },
    take: 20,
    select: SELECT,
  });
  return rows.map(toView);
}
