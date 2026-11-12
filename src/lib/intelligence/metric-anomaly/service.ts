import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { KIND_CAPABILITIES, type ObservabilityKind } from '../connectors/contract';
import { withDbBudget } from '../jobs/db-budget';
import { enqueueWorkItems, WORK_KINDS } from '../jobs/work-queue';
import { getIntelligenceSettings, parseOrThrow, type IntelligenceActor } from '../settings/service';
import {
  METRIC_EVALUATION_STATUS,
  METRIC_SCHEDULE_BATCH,
  METRIC_TEMPLATE_BOUNDS,
  metricTemplateInputSchema,
  type MetricDirection,
  type MetricTemplateView,
} from './contract';

/**
 * Administration and scheduling of per-service metric templates. A template only ever runs in the
 * intelligence lane; saving one does no network I/O, and nothing here is reachable from ingestion.
 */

type ConnectionScope = {
  enabled: boolean;
  kind: string;
  allowedTeamIds: readonly string[];
};

/**
 * Whether a service may use a connection: it must be enabled, able to answer metric queries, and either open
 * to every team or allowed for the service's owning team. A service without a team can use only connections
 * open to every team. Null means allowed; otherwise the evaluation status that explains why not.
 */
export function connectionScopeProblem(
  connection: ConnectionScope | null,
  service: { teamId: string | null }
): string | null {
  if (!connection) return METRIC_EVALUATION_STATUS.NO_CONNECTION;
  if (!connection.enabled) return METRIC_EVALUATION_STATUS.CONNECTION_DISABLED;
  const capabilities = KIND_CAPABILITIES[connection.kind as ObservabilityKind] ?? [];
  if (!capabilities.includes('metrics')) return METRIC_EVALUATION_STATUS.UNSUPPORTED;
  if (connection.allowedTeamIds.length === 0) return null;
  if (service.teamId && connection.allowedTeamIds.includes(service.teamId)) return null;
  return METRIC_EVALUATION_STATUS.CONNECTION_NOT_ALLOWED;
}

const SCOPE_MESSAGES: Record<string, { field: string; message: string }> = {
  [METRIC_EVALUATION_STATUS.NO_CONNECTION]: {
    field: 'connectionId',
    message: 'That connection no longer exists',
  },
  [METRIC_EVALUATION_STATUS.CONNECTION_DISABLED]: {
    field: 'connectionId',
    message: 'Enable the connection first',
  },
  [METRIC_EVALUATION_STATUS.UNSUPPORTED]: {
    field: 'connectionId',
    message: 'That connection cannot answer metric queries',
  },
  [METRIC_EVALUATION_STATUS.CONNECTION_NOT_ALLOWED]: {
    field: 'connectionId',
    message: "That connection is not allowed for this service's team",
  },
};

function invalid(field: string, message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', fields: [{ field, code: 'custom', message }] });
}

const auditSource = (actor: IntelligenceActor) => ({
  source: actor.source,
  details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
});

const SELECT = {
  id: true,
  serviceId: true,
  connectionId: true,
  name: true,
  query: true,
  enabled: true,
  direction: true,
  thresholdMad: true,
  baselineWeeks: true,
  windowMinutes: true,
  stepSeconds: true,
  intervalMinutes: true,
  minDeviation: true,
  lastEvaluatedAt: true,
  lastStatus: true,
  service: { select: { name: true } },
  connection: { select: { name: true } },
} as const;
type Row = Prisma.ServiceMetricTemplateGetPayload<{ select: typeof SELECT }>;

function toView(row: Row): MetricTemplateView {
  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    connectionId: row.connectionId,
    connectionName: row.connection?.name ?? null,
    name: row.name,
    query: row.query,
    enabled: row.enabled,
    direction: row.direction as MetricDirection,
    thresholdMad: row.thresholdMad,
    baselineWeeks: row.baselineWeeks,
    windowMinutes: row.windowMinutes,
    stepSeconds: row.stepSeconds,
    intervalMinutes: row.intervalMinutes,
    minDeviation: row.minDeviation,
    lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
  };
}

/** What the audit log records: the configuration, never evaluation results. */
const auditView = (view: MetricTemplateView) => {
  const { lastEvaluatedAt: _evaluated, lastStatus: _status, ...rest } = view;
  return rest;
};

export async function listMetricTemplates(
  client: typeof prisma = prisma
): Promise<MetricTemplateView[]> {
  const rows = await client.serviceMetricTemplate.findMany({
    orderBy: [{ service: { name: 'asc' } }, { name: 'asc' }],
    take: METRIC_TEMPLATE_BOUNDS.maxTemplates,
    select: SELECT,
  });
  return rows.map(toView);
}

/**
 * Creates or updates a template. Caller must authorize INTELLIGENCE_MANAGE. The connection must be enabled,
 * able to answer metric queries and usable by the service's team; this is checked again at every evaluation,
 * so a connection later disabled or narrowed simply stops producing evidence.
 */
export async function saveMetricTemplate(
  id: string | null,
  input: unknown,
  actor: IntelligenceActor
): Promise<MetricTemplateView> {
  const parsed = parseOrThrow(metricTemplateInputSchema, input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('service-metric-templates', 0))`;
    const [service, connection] = await Promise.all([
      tx.service.findUnique({ where: { id: parsed.serviceId }, select: { teamId: true } }),
      tx.observabilityConnection.findUnique({
        where: { id: parsed.connectionId },
        select: { enabled: true, kind: true, allowedTeamIds: true },
      }),
    ]);
    if (!service) throw invalid('serviceId', 'That service no longer exists');
    const problem = connectionScopeProblem(connection, service);
    if (problem) {
      // eslint-disable-next-line security/detect-object-injection -- problem is one of the fixed status codes
      const { field, message } = SCOPE_MESSAGES[problem];
      throw invalid(field, message);
    }
    if (id === null) {
      if ((await tx.serviceMetricTemplate.count()) >= METRIC_TEMPLATE_BOUNDS.maxTemplates)
        throw invalid('name', 'Template limit reached');
      if (
        (await tx.serviceMetricTemplate.count({ where: { serviceId: parsed.serviceId } })) >=
        METRIC_TEMPLATE_BOUNDS.maxTemplatesPerService
      )
        throw invalid('name', 'This service already has the maximum number of templates');
    }
    const duplicate = await tx.serviceMetricTemplate.findFirst({
      where: {
        serviceId: parsed.serviceId,
        name: parsed.name,
        ...(id ? { id: { not: id } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw invalid('name', 'This service already has a template with this name');

    let previous: MetricTemplateView | null = null;
    let row: Row;
    if (id === null) {
      row = await tx.serviceMetricTemplate.create({
        data: { ...parsed, createdById: actor.actorId, updatedById: actor.actorId },
        select: SELECT,
      });
    } else {
      const existing = await tx.serviceMetricTemplate.findUnique({ where: { id }, select: SELECT });
      if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      previous = toView(existing);
      // A changed query or baseline makes earlier evaluations meaningless for scheduling: run again soon.
      row = await tx.serviceMetricTemplate.update({
        where: { id },
        data: { ...parsed, updatedById: actor.actorId, lastEvaluatedAt: null, lastStatus: null },
        select: SELECT,
      });
    }
    const view = toView(row);
    await logAudit(
      {
        action:
          id === null
            ? 'intelligence.metric_template.created'
            : 'intelligence.metric_template.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: actor.actorId,
        ...auditSource(actor),
        ...(previous ? { oldValue: auditView(previous) } : {}),
        newValue: auditView(view),
      },
      tx
    );
    return view;
  });
}

/** Removes a template and, through the cascade, the anomalies it found. */
export async function deleteMetricTemplate(
  id: string,
  actor: IntelligenceActor
): Promise<'deleted' | 'not_found'> {
  return prisma.$transaction(async tx => {
    const row = await tx.serviceMetricTemplate.findUnique({ where: { id }, select: SELECT });
    if (!row) return 'not_found';
    await tx.serviceMetricTemplate.delete({ where: { id } });
    await logAudit(
      {
        action: 'intelligence.metric_template.deleted',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: auditView(toView(row)),
      },
      tx
    );
    return 'deleted';
  });
}

/** Operator action: evaluate now, through the lane, so the request itself queries nothing. */
export async function requestMetricEvaluation(id: string): Promise<boolean> {
  const row = await prisma.serviceMetricTemplate.findUnique({
    where: { id },
    select: { id: true, enabled: true },
  });
  if (!row || !row.enabled) return false;
  await enqueueWorkItems([{ kind: WORK_KINDS.EVALUATE_METRIC_TEMPLATE, subjectKey: row.id }]);
  return true;
}

/**
 * Enqueues one EVALUATE_METRIC_TEMPLATE item per enabled template whose interval has elapsed, oldest first,
 * at most METRIC_SCHEDULE_BATCH per check. Index-backed on (enabled, lastEvaluatedAt) and budgeted. While no
 * template is enabled this is one empty index probe.
 */
export async function scheduleMetricEvaluationsIfDue(
  settings: { maxDbMs: number },
  now: Date = new Date()
): Promise<number> {
  if (!(await getIntelligenceSettings()).enabled) return 0;
  const due = await withDbBudget(settings, tx =>
    tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ServiceMetricTemplate"
      WHERE "enabled" = true AND "connectionId" IS NOT NULL
        AND ("lastEvaluatedAt" IS NULL
          OR "lastEvaluatedAt" <= ${now}::timestamp - ("intervalMinutes" * interval '1 minute'))
      ORDER BY "lastEvaluatedAt" ASC NULLS FIRST, "id" ASC
      LIMIT ${METRIC_SCHEDULE_BATCH}`)
  );
  if (due.length === 0) return 0;
  return enqueueWorkItems(
    due.map(row => ({ kind: WORK_KINDS.EVALUATE_METRIC_TEMPLATE, subjectKey: row.id }))
  );
}
