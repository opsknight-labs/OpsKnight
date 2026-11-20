import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { AiDataClass } from '../ai/port';
import { KIND_CAPABILITIES, type ConnectorCapability } from '../connectors/contract';
import type { EligibleConnection } from '../connectors/service';
import { readIncidentForActor } from './deterministic';
import type { ConnectorToolAdder, ConnectorToolRunner } from './tools-observability';

/**
 * Discovery tools next to the observability tools: metric names and label values on Prometheus-compatible
 * connections, the per-service saved metric queries (the metric-anomaly templates), and read-only Kubernetes
 * state. Registered through tools-observability.ts, so they share its connection checks, redaction, and the
 * rule that connector tools never run over MCP.
 */
export const DISCOVERY_TOOL_DATA_CLASS: Readonly<Record<string, AiDataClass>> = {
  list_metrics: 'INTERNAL',
  label_values: 'INTERNAL',
  list_metric_templates: 'INTERNAL',
  get_k8s_state: 'INTERNAL',
};

export const DISCOVERY_TOOL_LABELS: Readonly<Record<string, string>> = {
  list_metrics: 'Listing metric names',
  label_values: 'Listing label values',
  list_metric_templates: 'Reading saved metric queries',
  get_k8s_state: 'Reading Kubernetes state',
};

export const DISCOVERY_TOOL_CAPABILITY: Readonly<Record<string, ConnectorCapability>> = {
  list_metrics: 'catalog',
  label_values: 'catalog',
  list_metric_templates: 'metrics',
  get_k8s_state: 'kubernetes',
};

export const DISCOVERY_CAP = 50;
const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };
const METRIC_NAME = /^[A-Za-z_:][A-Za-z0-9_:]*$/;
const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// DNS-1123 label: lower-case alphanumerics and dashes, at most 63, not starting or ending with a dash.
const NAMESPACE = /^[a-z0-9-]{1,63}$/;
// Equality, set and existence selectors: keys, values, `=`, `!=`, `in (...)`, `notin (...)`, `!key`.
const LABEL_SELECTOR = /^[A-Za-z0-9._/\-=!,() ]{1,200}$/;

const capped = (values: readonly string[]) => {
  const sorted = [...new Set(values)].sort();
  return {
    values: sorted.slice(0, DISCOVERY_CAP),
    total: sorted.length,
    truncated: sorted.length > DISCOVERY_CAP,
  };
};

export function buildDiscoveryTools(
  actor: AuthorizationActor,
  connections: readonly EligibleConnection[],
  add: ConnectorToolAdder,
  run: ConnectorToolRunner
): void {
  const connectionId = z.string().trim().min(1).max(64).optional();

  add(
    'list_metrics',
    `List metric names that start with a prefix on a Prometheus-compatible connection, at most ${DISCOVERY_CAP}. Use it before query_metrics when the metric name is unknown.`,
    { prefix: { type: 'string', maxLength: 200, description: 'Metric name prefix, e.g. http_' } },
    [],
    async input => {
      const parsed = z
        .object({
          connectionId,
          prefix: z
            .union([z.literal(''), z.string().trim().max(200).regex(METRIC_NAME)])
            .optional(),
        })
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) return { error: 'Invalid input: the prefix must be a metric name.' };
      const prefix = parsed.data.prefix ?? '';
      return run('list_metrics', parsed.data.connectionId, 'catalog', async (adapter, context) => {
        const names = await adapter.metricNames?.(context, prefix);
        return names && { prefix, ...capped(names) };
      });
    }
  );

  add(
    'label_values',
    `List the values one label takes on one metric on a Prometheus-compatible connection, at most ${DISCOVERY_CAP}.`,
    {
      metric: { type: 'string', minLength: 1, maxLength: 200 },
      label: { type: 'string', minLength: 1, maxLength: 100 },
    },
    ['metric', 'label'],
    async input => {
      const parsed = z
        .object({
          connectionId,
          metric: z.string().trim().min(1).max(200).regex(METRIC_NAME),
          label: z.string().trim().min(1).max(100).regex(LABEL_NAME),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) return { error: 'Invalid input: use a metric name and a label name.' };
      const { metric, label } = parsed.data;
      return run('label_values', parsed.data.connectionId, 'catalog', async (adapter, context) => {
        const values = await adapter.labelValues?.(context, metric, label);
        return values && { metric, label, ...capped(values) };
      });
    }
  );

  const metricConnectionIds = connections
    .filter(connection => KIND_CAPABILITIES[connection.kind].includes('metrics'))
    .map(connection => connection.id);
  add(
    'list_metric_templates',
    "List saved metric queries for a service (the metric anomaly templates): name, query and connection. Run one with query_metrics. Give serviceId, or incidentId for the incident's service.",
    {
      serviceId: { type: 'string', minLength: 1, maxLength: 64 },
      incidentId: { type: 'string', minLength: 1, maxLength: 64 },
    },
    [],
    async input => {
      const parsed = z
        .object({
          serviceId: z.string().trim().min(1).max(64).optional(),
          incidentId: z.string().trim().min(1).max(64).optional(),
        })
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) return { error: 'Invalid input' };
      let readable;
      try {
        readable = serviceReadWhere(actor);
      } catch {
        return NOT_FOUND;
      }
      let serviceName: string | undefined;
      if (parsed.data.incidentId) {
        const incident = await readIncidentForActor(actor, parsed.data.incidentId);
        if (!incident) return NOT_FOUND;
        serviceName = incident.serviceName;
      }
      const rows = await prisma.serviceMetricTemplate.findMany({
        where: {
          // Only templates on a connection this person may query, for a service they may read.
          connectionId: { in: metricConnectionIds },
          service: {
            AND: [
              readable,
              ...(parsed.data.serviceId ? [{ id: parsed.data.serviceId }] : []),
              ...(serviceName ? [{ name: serviceName }] : []),
            ],
          },
        },
        orderBy: [{ service: { name: 'asc' } }, { name: 'asc' }],
        take: DISCOVERY_CAP,
        select: {
          name: true,
          query: true,
          connectionId: true,
          service: { select: { id: true, name: true } },
        },
      });
      return {
        templates: rows.map(row => ({
          serviceId: row.service.id,
          serviceName: row.service.name,
          name: row.name,
          query: row.query,
          connectionId: row.connectionId,
        })),
      };
    }
  );

  add(
    'get_k8s_state',
    'Read-only Kubernetes state for one namespace, optionally narrowed by a label selector: workloads with rollout status (stalled first), pods that restarted or are not ready, and the newest events. Capped at 15 workloads, 10 pods and 15 events.',
    {
      namespace: { type: 'string', minLength: 1, maxLength: 63 },
      labelSelector: { type: 'string', maxLength: 200, description: 'e.g. app=checkout' },
    },
    ['namespace'],
    async input => {
      const parsed = z
        .object({
          connectionId,
          namespace: z
            .string()
            .trim()
            .regex(NAMESPACE)
            .refine(value => !value.startsWith('-') && !value.endsWith('-')),
          labelSelector: z
            .union([z.literal(''), z.string().trim().regex(LABEL_SELECTOR)])
            .optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success)
        return { error: 'Invalid input: use a namespace name and a label selector like app=api.' };
      const { namespace, labelSelector } = parsed.data;
      return run('get_k8s_state', parsed.data.connectionId, 'kubernetes', (adapter, context) =>
        adapter.kubernetes?.(context, { namespace, labelSelector: labelSelector || undefined })
      );
    }
  );
}
