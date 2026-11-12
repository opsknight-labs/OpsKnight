import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import type { AiDataClass, AiToolDefinition } from '../ai/port';
import { redactPersonalData, redactSecrets } from '../ai/redact';
import { CONNECTOR_ADAPTERS, parseChangeUrl, webHostOf } from '../connectors/adapters';
import type { ChangeRef } from '../connectors/adapters/types';
import {
  CONNECTOR_BOUNDS,
  KIND_CAPABILITIES,
  KIND_LABELS,
  type ConnectorCapability,
} from '../connectors/contract';
import { ConnectorError, type ConnectorFetch } from '../connectors/http';
import type { TimeWindow } from '../connectors/normalize';
import { contextFor, loadConnectionForActor, type EligibleConnection } from '../connectors/service';
import { readIncidentForActor } from './deterministic';

/**
 * Squire's observability read tools. Each one is offered only when the person has at least one enabled
 * connection of a kind that can answer it, re-checks that connection at execution time, queries it read-only
 * through the guarded fetch within a bounded window, and returns a compact, redacted summary. Logs can carry
 * customer data, so `search_logs` is Personal; everything else is Internal operational data.
 */
export const OBSERVABILITY_TOOL_DATA_CLASS: Readonly<Record<string, AiDataClass>> = {
  query_metrics: 'INTERNAL',
  search_logs: 'PERSONAL',
  get_traces: 'INTERNAL',
  get_error_events: 'INTERNAL',
  get_change_diff: 'INTERNAL',
};

export const OBSERVABILITY_TOOL_LABELS: Readonly<Record<string, string>> = {
  query_metrics: 'Querying metrics',
  search_logs: 'Searching logs',
  get_traces: 'Reading traces',
  get_error_events: 'Checking error events',
  get_change_diff: 'Reading the change diff',
};

export const OBSERVABILITY_TOOL_NAMES = Object.keys(OBSERVABILITY_TOOL_DATA_CLASS);

const TOOL_CAPABILITY: Readonly<Record<string, ConnectorCapability>> = {
  query_metrics: 'metrics',
  search_logs: 'logs',
  get_traces: 'traces',
  get_error_events: 'errors',
  get_change_diff: 'diff',
};

const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };
const HALF_HOUR = 30 * 60_000;
const MAX_LOG_LINES = 50;

const ERROR_MESSAGES: Record<ConnectorError['code'], string> = {
  BLOCKED: 'The connection address is not allowed.',
  UNREACHABLE: 'The connection could not be reached.',
  TIMEOUT: 'The connection did not answer in time. Try a narrower query or a shorter window.',
  TOO_LARGE: 'The result was too large. Narrow the query or shorten the window.',
  HTTP_ERROR: 'The connection rejected the query. Check the query syntax for this backend.',
  INVALID_RESPONSE: 'The connection returned data that could not be read.',
  UNSUPPORTED: 'This connection cannot answer that question.',
  ABORTED: 'The request was cancelled.',
};

const windowFields = {
  incidentId: { type: 'string', minLength: 1, maxLength: 64 },
  start: { type: 'string', maxLength: 40, description: 'ISO 8601 date-time' },
  end: { type: 'string', maxLength: 40, description: 'ISO 8601 date-time' },
  minutes: { type: 'integer', minimum: 1, maximum: CONNECTOR_BOUNDS.maxWindowMs / 60_000 },
};
const windowInput = {
  incidentId: z.string().trim().min(1).max(64).optional(),
  start: z.iso.datetime({ offset: true }).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
  minutes: z
    .number()
    .int()
    .min(1)
    .max(CONNECTOR_BOUNDS.maxWindowMs / 60_000)
    .optional(),
};
type WindowInput = { incidentId?: string; start?: string; end?: string; minutes?: number };

/**
 * The query window. Explicit start/end win; otherwise one hour around the incident's start; otherwise the
 * last `minutes` (default 60). Never longer than 24 hours and never in the future.
 */
export async function resolveWindow(
  actor: AuthorizationActor,
  input: WindowInput,
  now: Date = new Date()
): Promise<TimeWindow | null> {
  const max = CONNECTOR_BOUNDS.maxWindowMs;
  let end: number;
  let start: number;
  if (input.start || input.end) {
    end = Math.min(now.getTime(), input.end ? Date.parse(input.end) : now.getTime());
    start = input.start ? Date.parse(input.start) : end - CONNECTOR_BOUNDS.defaultWindowMs;
  } else if (input.incidentId) {
    const incident = await readIncidentForActor(actor, input.incidentId);
    if (!incident) return null;
    const onset = incident.createdAt.getTime();
    start = onset - HALF_HOUR;
    end = Math.min(now.getTime(), onset + HALF_HOUR);
  } else {
    end = now.getTime();
    start = end - (input.minutes ? input.minutes * 60_000 : CONNECTOR_BOUNDS.defaultWindowMs);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  start = Math.max(start, end - max);
  return { start: new Date(start), end: new Date(end) };
}

/** Applies a string transform to every string in a JSON-shaped value. */
function mapStrings(value: unknown, transform: (text: string) => string, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform, depth + 1)])
    );
  return value;
}

/**
 * Secrets are removed from every result. Internal-class results also lose email addresses and phone numbers
 * (host and pod addresses are operational data and stay), so they cannot carry Personal data.
 */
export function redactConnectorResult(value: unknown, dataClass: AiDataClass): unknown {
  return mapStrings(value, text => {
    const safe = redactSecrets(text);
    return dataClass === 'PERSONAL' || dataClass === 'SENSITIVE'
      ? safe
      : redactPersonalData(safe, { email: true, phone: true, ip: false });
  });
}

function connectionList(connections: readonly EligibleConnection[]): string {
  return connections
    .map(
      connection => `"${connection.name}" (${KIND_LABELS[connection.kind]}, id ${connection.id})`
    )
    .join('; ');
}

export function buildObservabilityTools(
  actor: AuthorizationActor,
  connections: readonly EligibleConnection[],
  options: { signal?: AbortSignal; fetch?: ConnectorFetch } = {}
): AiToolDefinition[] {
  const capable = (capability: ConnectorCapability) =>
    connections.filter(connection => KIND_CAPABILITIES[connection.kind].includes(capability));

  async function run(
    tool: string,
    connectionId: string | undefined,
    capability: ConnectorCapability,
    call: (
      adapter: (typeof CONNECTOR_ADAPTERS)[keyof typeof CONNECTOR_ADAPTERS],
      context: ReturnType<typeof contextFor>
    ) => Promise<unknown> | undefined,
    extra: Record<string, unknown> = {}
  ): Promise<unknown> {
    const candidates = capable(capability);
    const id = connectionId ?? (candidates.length === 1 ? candidates[0].id : undefined);
    if (!id)
      return {
        error: `Choose a connection with connectionId: ${connectionList(candidates)}.`,
      };
    // Eligibility is checked again now: the connection may have been disabled or re-scoped.
    const connection = await loadConnectionForActor(actor, id);
    if (!connection || !KIND_CAPABILITIES[connection.kind].includes(capability)) return NOT_FOUND;
    const adapter = CONNECTOR_ADAPTERS[connection.kind];
    try {
      const summary = await call(adapter, contextFor(connection, options));
      if (summary === undefined) return { error: ERROR_MESSAGES.UNSUPPORTED };
      // eslint-disable-next-line security/detect-object-injection -- tool is one of the fixed names above
      const dataClass = OBSERVABILITY_TOOL_DATA_CLASS[tool] ?? 'PERSONAL';
      return redactConnectorResult(
        {
          connectionId: connection.id,
          connectionName: connection.name,
          backend: KIND_LABELS[connection.kind],
          ...extra,
          ...(summary as Record<string, unknown>),
        },
        dataClass
      );
    } catch (error) {
      const code = error instanceof ConnectorError ? error.code : 'UNREACHABLE';
      logger.info('[Squire] Connector query failed', {
        tool,
        kind: connection.kind,
        code,
        status: error instanceof ConnectorError ? error.status : undefined,
      });
      // eslint-disable-next-line security/detect-object-injection -- code is a member of the closed union
      return { error: ERROR_MESSAGES[code] };
    }
  }

  const tools: AiToolDefinition[] = [];
  const add = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    execute: (input: unknown) => Promise<unknown>
  ) => {
    // eslint-disable-next-line security/detect-object-injection -- name is one of the fixed tool names
    const candidates = capable(TOOL_CAPABILITY[name]);
    if (candidates.length === 0) return;
    tools.push({
      name,
      kind: 'READ',
      // eslint-disable-next-line security/detect-object-injection -- name is one of the fixed tool names
      dataClass: OBSERVABILITY_TOOL_DATA_CLASS[name],
      description: `${description} Connections: ${connectionList(candidates)}.`,
      inputSchema: {
        type: 'object',
        properties: {
          connectionId: { type: 'string', enum: candidates.map(connection => connection.id) },
          ...properties,
        },
        required,
        additionalProperties: false,
      },
      execute,
    });
  };

  const connectionId = z.string().trim().min(1).max(64).optional();

  add(
    'query_metrics',
    "Query a metrics backend (PromQL for Prometheus and Grafana, a Datadog metrics query, or a CloudWatch Metrics Insights / SEARCH expression). Returns per-series min, max, mean, last value, the biggest jump and a few samples. Default window: one hour around the incident's start when incidentId is given, otherwise the last hour; at most 24 hours.",
    { query: { type: 'string', minLength: 1, maxLength: 1000 }, ...windowFields },
    ['query'],
    async input => {
      const parsed = z
        .object({ connectionId, query: z.string().trim().min(1).max(1000), ...windowInput })
        .strict()
        .safeParse(input);
      if (!parsed.success) return { error: 'Invalid input' };
      const window = await resolveWindow(actor, parsed.data);
      if (!window) return NOT_FOUND;
      return run('query_metrics', parsed.data.connectionId, 'metrics', (adapter, context) =>
        adapter.metrics?.(context, { query: parsed.data.query, window })
      );
    }
  );

  add(
    'search_logs',
    'Search logs (LogQL for Loki and Grafana, a Datadog or Lucene query for Elasticsearch, a CloudWatch filter pattern). Returns the newest matching lines with timestamps, at most 15. Same default window as query_metrics.',
    {
      query: { type: 'string', minLength: 1, maxLength: 1000 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES },
      ...windowFields,
    },
    ['query'],
    async input => {
      const parsed = z
        .object({
          connectionId,
          query: z.string().trim().min(1).max(1000),
          limit: z.number().int().min(1).max(MAX_LOG_LINES).optional(),
          ...windowInput,
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) return { error: 'Invalid input' };
      const window = await resolveWindow(actor, parsed.data);
      if (!window) return NOT_FOUND;
      return run('search_logs', parsed.data.connectionId, 'logs', (adapter, context) =>
        adapter.logs?.(context, {
          query: parsed.data.query,
          window,
          limit: parsed.data.limit ?? 30,
        })
      );
    }
  );

  add(
    'get_traces',
    'Read distributed traces: one trace by traceId as a span tree (slowest paths first, errors marked), or a search (TraceQL for Tempo, a span query for Datadog; default: traces with errors). Same default window as query_metrics.',
    {
      traceId: { type: 'string', maxLength: 32, description: 'Hexadecimal trace id' },
      query: { type: 'string', maxLength: 500 },
      ...windowFields,
    },
    [],
    async input => {
      const parsed = z
        .object({
          connectionId,
          traceId: z
            .string()
            .trim()
            .regex(/^[0-9a-fA-F]{1,32}$/)
            .optional(),
          query: z.string().trim().max(500).optional(),
          ...windowInput,
        })
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) return { error: 'Invalid input' };
      const window = await resolveWindow(actor, parsed.data);
      if (!window) return NOT_FOUND;
      return run('get_traces', parsed.data.connectionId, 'traces', (adapter, context) =>
        adapter.traces?.(context, {
          traceId: parsed.data.traceId,
          query: parsed.data.query || undefined,
          window,
        })
      );
    }
  );

  add(
    'get_error_events',
    'List application error issues (Sentry) seen in the window, most frequent first: title, culprit, level, event and user counts, first and last seen. Optional Sentry search query. Same default window as query_metrics.',
    { query: { type: 'string', maxLength: 300 }, ...windowFields },
    [],
    async input => {
      const parsed = z
        .object({ connectionId, query: z.string().trim().max(300).optional(), ...windowInput })
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) return { error: 'Invalid input' };
      const window = await resolveWindow(actor, parsed.data);
      if (!window) return NOT_FOUND;
      return run('get_error_events', parsed.data.connectionId, 'errors', (adapter, context) =>
        adapter.errors?.(context, { query: parsed.data.query || undefined, window })
      );
    }
  );

  add(
    'get_change_diff',
    'Read the code diff behind a recorded change (a GitHub commit, pull request or compare view, or a GitLab commit or merge request): changed files, additions and deletions and a truncated patch. Give the change id from get_recent_changes or get_intelligence.',
    { changeId: { type: 'string', minLength: 1, maxLength: 64 } },
    ['changeId'],
    async input => {
      const parsed = z
        .object({ connectionId, changeId: z.string().trim().min(1).max(64) })
        .strict()
        .safeParse(input);
      if (!parsed.success) return { error: 'Invalid input' };
      let readable;
      try {
        readable = serviceReadWhere(actor);
      } catch {
        return NOT_FOUND;
      }
      const change = await prisma.changeEvent.findFirst({
        where: {
          id: parsed.data.changeId,
          ...(Object.keys(readable).length
            ? { OR: [{ serviceId: null }, { service: readable }] }
            : {}),
        },
        select: { id: true, url: true },
      });
      if (!change) return NOT_FOUND;
      const ref: ChangeRef | null = change.url ? parseChangeUrl(change.url) : null;
      if (!ref)
        return { error: 'This change has no GitHub or GitLab commit or pull request link.' };
      const kind = ref.provider === 'github' ? 'GITHUB' : 'GITLAB';
      const matching = capable('diff').filter(
        connection =>
          connection.kind === kind &&
          webHostOf(kind, connection.baseUrl) === ref.host &&
          (!parsed.data.connectionId || connection.id === parsed.data.connectionId)
      );
      if (matching.length === 0)
        return {
          error: `No ${kind === 'GITHUB' ? 'GitHub' : 'GitLab'} connection for ${ref.host}.`,
        };
      return run(
        'get_change_diff',
        matching[0].id,
        'diff',
        (adapter, context) => adapter.diff?.(context, ref),
        { changeId: change.id }
      );
    }
  );

  return tools;
}
