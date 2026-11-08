import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import {
  incidentReadWhere,
  runbookReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { evaluateServiceObjective } from '@/lib/slo/evaluator';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import type { AiDataClass, AiToolDefinition } from '../ai/port';
import { redactSecrets, sanitizeUntrusted } from '../ai/redact';
import { readIncidentForActor } from './deterministic';

/**
 * Incident-response read tools for the AI assistant (Workstream F2). Every tool:
 *  - runs under the asking person's own visibility (`*ReadWhere` helpers, `readIncidentForActor`), so it can
 *    never return more than the person could open in the application;
 *  - declares the class of data it can return (below), so a provider not cleared for it never receives it;
 *  - returns a compact, bounded summary with stable ids, which the evidence registry turns into citations;
 *  - never returns configuration that may carry secrets (runbook step config, integration payload keys
 *    shaped like credentials are redacted), and its result is redacted again by the gateway envelope.
 * Nothing here writes.
 */
export const INCIDENT_TOOL_DATA_CLASS: Readonly<Record<string, AiDataClass>> = {
  // Alert payloads are third-party text and routinely carry hostnames, emails and user names.
  get_alert_payload: 'PERSONAL',
  get_runbook_steps: 'INTERNAL',
  get_slo_status: 'INTERNAL',
  incident_analytics: 'INTERNAL',
  // Escalation steps name the people who are paged.
  get_escalation_policy: 'PERSONAL',
};

/** Labels shown while a tool runs (present tense, no trailing ellipsis). */
export const INCIDENT_TOOL_LABELS: Readonly<Record<string, string>> = {
  get_alert_payload: 'Reading the alert payload',
  get_runbook_steps: 'Reading the runbook steps',
  get_slo_status: 'Checking service objectives',
  incident_analytics: 'Computing incident analytics',
  get_escalation_policy: 'Reading the escalation policy',
};

const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };
const INVALID = { error: 'Invalid input' };
const id = z.string().trim().min(1).max(64);
const idSchema = { type: 'string', minLength: 1, maxLength: 64 };

/** Bounds for one alert payload as the model sees it. The gateway caps the whole result again. */
export const PAYLOAD_LIMITS = { depth: 5, keys: 40, items: 10, string: 400, bytes: 6_000 } as const;
const MAX_ANALYTICS_HOURS = 24 * 30;

const short = (text: string | null | undefined, max = 280) => {
  const value = (text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

function guarded<T>(build: () => T): T | null {
  try {
    return build();
  } catch {
    return null;
  }
}

/**
 * Prunes an alert payload to a bounded tree: limited depth, keys, array items and string length, with every
 * string secret-redacted and instruction-like text neutralised. Keys that name a credential lose their value
 * entirely, whatever its shape. Returns the pruned value and whether anything was cut.
 */
export function compactPayload(value: unknown): { payload: unknown; truncated: boolean } {
  let truncated = false;
  const SECRET_KEY =
    /(?:pass(?:word|wd)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|signature)/i;
  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || typeof node === 'number' || typeof node === 'boolean') return node;
    if (typeof node === 'string') {
      if (node.length > PAYLOAD_LIMITS.string) truncated = true;
      return redactSecrets(short(node, PAYLOAD_LIMITS.string));
    }
    if (depth >= PAYLOAD_LIMITS.depth) {
      truncated = true;
      return '[nested data omitted]';
    }
    if (Array.isArray(node)) {
      if (node.length > PAYLOAD_LIMITS.items) truncated = true;
      return node.slice(0, PAYLOAD_LIMITS.items).map(item => walk(item, depth + 1));
    }
    if (typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      if (entries.length > PAYLOAD_LIMITS.keys) truncated = true;
      return Object.fromEntries(
        entries
          .slice(0, PAYLOAD_LIMITS.keys)
          .map(([key, item]) => [
            key.slice(0, 80),
            SECRET_KEY.test(key) ? '[redacted]' : walk(item, depth + 1),
          ])
      );
    }
    return String(node).slice(0, 40);
  };
  let payload = sanitizeUntrusted(walk(value, 0));
  // A payload can still be wide after pruning; keep the summary within a fixed budget.
  if (JSON.stringify(payload ?? null).length > PAYLOAD_LIMITS.bytes) {
    truncated = true;
    payload = {
      excerpt: `${JSON.stringify(payload).slice(0, PAYLOAD_LIMITS.bytes)}…`,
    };
  }
  return { payload, truncated };
}

const objectInput = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

function readTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  execute: (input: unknown) => Promise<unknown>
): AiToolDefinition {
  return {
    name,
    description,
    kind: 'READ',
    inputSchema,
    execute,
    // eslint-disable-next-line security/detect-object-injection -- name is one of this module's fixed tool names
    dataClass: INCIDENT_TOOL_DATA_CLASS[name],
  };
}

/**
 * The incident-response read tools for one actor. `personal` controls whether tools that can return Personal
 * data are offered at all (a provider limited to Internal data never sees them).
 */
export function buildIncidentTools(
  actor: AuthorizationActor,
  options: { personal: boolean }
): AiToolDefinition[] {
  const tools: AiToolDefinition[] = [
    readTool(
      'get_runbook_steps',
      'Read the published steps of one runbook by id: each step name, type, risk class, whether it needs approval and its description. Never returns step configuration.',
      objectInput({ id: idSchema }, ['id']),
      async input => {
        const parsed = z.object({ id }).strict().safeParse(input);
        if (!parsed.success) return INVALID;
        const readable = guarded(() => runbookReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const runbook = await prisma.runbook.findFirst({
          where: { AND: [{ id: parsed.data.id, archivedAt: null }, readable] },
          select: {
            id: true,
            name: true,
            updatedAt: true,
            publishedVersion: { select: { version: true, definition: true } },
          },
        });
        if (!runbook) return NOT_FOUND;
        const definition = runbook.publishedVersion?.definition;
        const rawSteps =
          definition && typeof definition === 'object' && !Array.isArray(definition)
            ? (definition as { steps?: unknown }).steps
            : undefined;
        const steps = (Array.isArray(rawSteps) ? rawSteps : []).slice(0, 25).map((step, index) => {
          const value = (step && typeof step === 'object' ? step : {}) as Record<string, unknown>;
          const text = (field: unknown, max: number) =>
            typeof field === 'string' ? redactSecrets(short(field, max)) : null;
          return {
            order: index + 1,
            key: text(value.key, 80),
            name: text(value.name, 200),
            type: text(value.type, 40),
            riskClass: text(value.riskClass, 40) ?? 'READ_ONLY',
            requiresApproval: value.requiresApproval === true,
            description: text(value.description, 300),
          };
        });
        return {
          id: runbook.id,
          name: runbook.name,
          href: `/runbooks/${runbook.id}`,
          updatedAt: runbook.updatedAt.toISOString(),
          publishedVersion: runbook.publishedVersion?.version ?? null,
          steps,
          note: runbook.publishedVersion
            ? undefined
            : 'This runbook has no published version; it cannot be run yet.',
        };
      }
    ),
    readTool(
      'get_slo_status',
      'Service objectives (SLOs) for one service id, with current attainment over each objective window, computed under your own visibility. At most 5 objectives.',
      objectInput({ serviceId: idSchema }, ['serviceId']),
      async input => {
        const parsed = z.object({ serviceId: id }).strict().safeParse(input);
        if (!parsed.success) return INVALID;
        const services = guarded(() => serviceReadWhere(actor));
        const objectives = guarded(() => serviceObjectiveReadWhere(actor));
        if (!services || !objectives) return NOT_FOUND;
        const service = await prisma.service.findFirst({
          where: { AND: [{ id: parsed.data.serviceId }, services] },
          select: { id: true, name: true, updatedAt: true },
        });
        if (!service) return NOT_FOUND;
        const rows = await prisma.serviceObjective.findMany({
          where: { AND: [{ serviceId: service.id, activeTo: null }, objectives] },
          orderBy: [{ metricType: 'asc' }, { name: 'asc' }],
          take: 5,
          select: {
            id: true,
            lineageId: true,
            serviceId: true,
            name: true,
            metricType: true,
            target: true,
            comparator: true,
            windowType: true,
            windowValue: true,
            version: true,
          },
        });
        const evaluated = await Promise.all(
          rows.map(async row => {
            const result = await evaluateServiceObjective({ actor, objective: row }).catch(
              () => null
            );
            return {
              name: short(row.name, 120),
              metric: row.metricType,
              target: row.target,
              comparator: row.comparator === 'GREATER_THAN_OR_EQUAL' ? '>=' : '<=',
              window: row.windowType,
              value: result?.value ?? null,
              compliant: result?.compliant ?? null,
              dataState: result?.dataState ?? 'UNAVAILABLE',
            };
          })
        );
        return {
          id: service.id,
          name: service.name,
          href: `/services/${service.id}`,
          updatedAt: service.updatedAt.toISOString(),
          objectives: evaluated,
          note:
            evaluated.length === 0
              ? 'No active service objectives are defined for this service.'
              : 'Attainment is computed from incidents you can see; it is not a customer-facing SLA report.',
        };
      }
    ),
    readTool(
      'incident_analytics',
      'Incident analytics over the last N hours (default 168, at most 720), optionally for one service id: total, counts by status and urgency, mean time to acknowledge and resolve (SLA elapsed time, excluding paused time), and the noisiest services. Only incidents you can see are counted.',
      objectInput(
        {
          serviceId: idSchema,
          hours: { type: 'integer', minimum: 1, maximum: MAX_ANALYTICS_HOURS },
        },
        []
      ),
      async input => {
        const parsed = z
          .object({
            serviceId: id.optional(),
            hours: z.number().int().min(1).max(MAX_ANALYTICS_HOURS).optional(),
          })
          .strict()
          .safeParse(input ?? {});
        if (!parsed.success) return INVALID;
        const readable = guarded(() => incidentReadWhere(actor));
        const services = guarded(() => serviceReadWhere(actor));
        if (!readable || !services) return NOT_FOUND;
        const hours = parsed.data.hours ?? 168;
        const since = new Date(Date.now() - hours * 3_600_000);
        if (parsed.data.serviceId) {
          const visible = await prisma.service.findFirst({
            where: { AND: [{ id: parsed.data.serviceId }, services] },
            select: { id: true },
          });
          if (!visible) return NOT_FOUND;
        }
        const where = {
          AND: [
            { createdAt: { gte: since } },
            ...(parsed.data.serviceId ? [{ serviceId: parsed.data.serviceId }] : []),
            readable,
          ],
        };
        // Aggregates run in the database; nothing is loaded row by row.
        const [totals, byStatus, byUrgency, noisy] = await Promise.all([
          prisma.incident.aggregate({
            where,
            _count: { _all: true, slaAckElapsedMs: true, slaResolveElapsedMs: true },
            _avg: { slaAckElapsedMs: true, slaResolveElapsedMs: true },
          }),
          prisma.incident.groupBy({ by: ['status'], where, _count: { _all: true } }),
          prisma.incident.groupBy({ by: ['urgency'], where, _count: { _all: true } }),
          prisma.incident.groupBy({
            by: ['serviceId'],
            where,
            _count: { _all: true },
            orderBy: [{ _count: { serviceId: 'desc' } }, { serviceId: 'asc' }],
            take: 5,
          }),
        ]);
        const named = await prisma.service.findMany({
          where: { AND: [{ id: { in: noisy.map(row => row.serviceId) } }, services] },
          select: { id: true, name: true, updatedAt: true },
        });
        const minutes = (value: number | null | undefined) =>
          typeof value === 'number' && Number.isFinite(value)
            ? Math.round((value / 60_000) * 10) / 10
            : null;
        return {
          window: { hours, since: since.toISOString() },
          serviceId: parsed.data.serviceId ?? null,
          total: totals._count._all,
          byStatus: Object.fromEntries(byStatus.map(row => [row.status, row._count._all])),
          byUrgency: Object.fromEntries(byUrgency.map(row => [row.urgency, row._count._all])),
          meanTimeToAcknowledgeMinutes: minutes(totals._avg.slaAckElapsedMs),
          acknowledgedSamples: totals._count.slaAckElapsedMs,
          meanTimeToResolveMinutes: minutes(totals._avg.slaResolveElapsedMs),
          resolvedSamples: totals._count.slaResolveElapsedMs,
          noisiestServices: noisy.flatMap(row => {
            const service = named.find(item => item.id === row.serviceId);
            return service
              ? [
                  {
                    id: service.id,
                    name: service.name,
                    href: `/services/${service.id}`,
                    incidents: row._count._all,
                    updatedAt: service.updatedAt.toISOString(),
                  },
                ]
              : [];
          }),
        };
      }
    ),
  ];

  if (options.personal) {
    tools.push(
      readTool(
        'get_alert_payload',
        'Read the payload of one alert that belongs to an incident you can see: labels, summary and source fields, pruned and with credentials redacted. Pass the incident id and the alert id (from list_alerts).',
        objectInput({ incidentId: idSchema, alertId: idSchema }, ['incidentId', 'alertId']),
        async input => {
          const parsed = z.object({ incidentId: id, alertId: id }).strict().safeParse(input);
          if (!parsed.success) return INVALID;
          if (!(await readIncidentForActor(actor, parsed.data.incidentId))) return NOT_FOUND;
          const alert = await prisma.alert.findFirst({
            where: { id: parsed.data.alertId, incidentId: parsed.data.incidentId },
            select: {
              id: true,
              status: true,
              severity: true,
              dedupKey: true,
              labels: true,
              payload: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          if (!alert) return NOT_FOUND;
          const payload = compactPayload(alert.payload);
          const labels = compactPayload(alert.labels ?? {});
          return {
            id: alert.id,
            incidentId: parsed.data.incidentId,
            href: `/alerts/${alert.id}`,
            status: alert.status,
            severity: alert.severity,
            dedupKey: alert.dedupKey ? redactSecrets(short(alert.dedupKey, 160)) : null,
            receivedAt: alert.createdAt.toISOString(),
            ...(alert.updatedAt ? { updatedAt: alert.updatedAt.toISOString() } : {}),
            labels: labels.payload,
            payload: payload.payload,
            truncated: payload.truncated || labels.truncated,
          };
        }
      ),
      readTool(
        'get_escalation_policy',
        'Read the escalation policy of one service id: each step in order, its delay and who it pages (person, team or on-call schedule).',
        objectInput({ serviceId: idSchema }, ['serviceId']),
        async input => {
          const parsed = z.object({ serviceId: id }).strict().safeParse(input);
          if (!parsed.success) return INVALID;
          const services = guarded(() => serviceReadWhere(actor));
          const schedules = guarded(() => scheduleReadWhere(actor));
          if (!services || !schedules) return NOT_FOUND;
          const service = await prisma.service.findFirst({
            where: { AND: [{ id: parsed.data.serviceId }, services] },
            select: {
              id: true,
              name: true,
              updatedAt: true,
              policy: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  steps: {
                    orderBy: { stepOrder: 'asc' },
                    take: 10,
                    select: {
                      stepOrder: true,
                      delayMinutes: true,
                      targetType: true,
                      notifyOnlyTeamLead: true,
                      targetUser: { select: { name: true } },
                      targetTeam: { select: { name: true } },
                      targetSchedule: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          });
          if (!service) return NOT_FOUND;
          if (!service.policy)
            return {
              id: service.id,
              name: service.name,
              href: `/services/${service.id}`,
              updatedAt: service.updatedAt.toISOString(),
              policy: null,
              note: 'This service has no escalation policy, so nobody is paged automatically.',
            };
          const scheduleIds = service.policy.steps.flatMap(step =>
            step.targetSchedule ? [step.targetSchedule.id] : []
          );
          // A schedule is only identified when the person may open it; otherwise it stays anonymous.
          const visibleSchedules = new Set(
            scheduleIds.length
              ? (
                  await prisma.onCallSchedule.findMany({
                    where: { AND: [{ id: { in: scheduleIds } }, schedules] },
                    select: { id: true },
                  })
                ).map(row => row.id)
              : []
          );
          return {
            id: service.id,
            name: service.name,
            href: `/services/${service.id}`,
            updatedAt: service.updatedAt.toISOString(),
            policy: {
              name: service.policy.name,
              description: short(service.policy.description, 300),
              steps: service.policy.steps.map(step => ({
                order: step.stepOrder,
                delayMinutes: step.delayMinutes,
                targetType: step.targetType,
                target:
                  step.targetUser?.name ??
                  step.targetTeam?.name ??
                  (step.targetSchedule && visibleSchedules.has(step.targetSchedule.id)
                    ? step.targetSchedule.name
                    : step.targetSchedule
                      ? 'An on-call schedule you cannot open'
                      : null),
                ...(step.targetSchedule && visibleSchedules.has(step.targetSchedule.id)
                  ? { scheduleId: step.targetSchedule.id }
                  : {}),
                ...(step.notifyOnlyTeamLead ? { teamLeadOnly: true } : {}),
              })),
            },
          };
        }
      )
    );
  }
  return tools;
}
