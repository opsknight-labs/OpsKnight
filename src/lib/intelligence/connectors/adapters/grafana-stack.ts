import { ConnectorError } from '../http';
import {
  summarizeLogs,
  summarizeSeries,
  summarizeTraces,
  type RawLogLine,
  type RawSeries,
  type RawSpan,
} from '../normalize';
import {
  asArray,
  asRecord,
  autoStep,
  bearerOrBasic,
  httpFor,
  seconds,
  type AdapterContext,
  type ConnectorAdapter,
  type LogsQuery,
  type MetricsQuery,
  type TracesQuery,
} from './types';

/* Prometheus, Loki and Tempo speak their own HTTP APIs; Grafana proxies the same APIs through a data source. */

function promMatrix(body: unknown): RawSeries[] {
  const data = asRecord(asRecord(body).data);
  return asArray(data.result).map(item => {
    const entry = asRecord(item);
    const values = asArray(entry.values).length ? asArray(entry.values) : [entry.value];
    return {
      labels: asRecord(entry.metric),
      points: values.flatMap(point => {
        const pair = asArray(point);
        const at = Number(pair[0]) * 1000;
        const value = Number(pair[1]);
        return Number.isFinite(at) && Number.isFinite(value)
          ? [[at, value] as [number, number]]
          : [];
      }),
    };
  });
}

async function promRange(context: AdapterContext, prefix: string, query: MetricsQuery) {
  const http = httpFor(context, {
    ...bearerOrBasic(context.connection.credential),
    ...grafanaOrg(context),
  });
  const body = await http.getJson(`${prefix}/api/v1/query_range`, {
    query: {
      query: query.query,
      start: seconds(query.window.start),
      end: seconds(query.window.end),
      step: autoStep(query.window, query.stepSeconds),
    },
  });
  if (asRecord(body).status !== 'success')
    throw new ConnectorError('INVALID_RESPONSE', 'The query was not accepted');
  return summarizeSeries(query.query, query.window, promMatrix(body));
}

const nanos = (date: Date) => `${BigInt(date.getTime()) * BigInt(1_000_000)}`;

async function lokiRange(context: AdapterContext, prefix: string, query: LogsQuery) {
  const http = httpFor(context, {
    ...bearerOrBasic(context.connection.credential),
    ...grafanaOrg(context),
  });
  const body = await http.getJson(`${prefix}/loki/api/v1/query_range`, {
    query: {
      query: query.query,
      start: nanos(query.window.start),
      end: nanos(query.window.end),
      limit: query.limit,
      direction: 'backward',
    },
  });
  const lines: RawLogLine[] = asArray(asRecord(asRecord(body).data).result).flatMap(item => {
    const stream = asRecord(item);
    const labels = asRecord(stream.stream);
    return asArray(stream.values).map(value => {
      const pair = asArray(value);
      return { at: Number(String(pair[0] ?? '0').slice(0, -6)), text: pair[1], labels };
    });
  });
  return summarizeLogs(query.query, query.window, lines);
}

function grafanaOrg(context: AdapterContext): Record<string, string> {
  return context.connection.kind === 'GRAFANA' && context.connection.org
    ? { 'x-grafana-org-id': context.connection.org }
    : {};
}

/** Tempo returns OTLP JSON: resource batches of scope spans. Both the v1 and v2 envelope shapes are read. */
export function otlpSpans(body: unknown): RawSpan[] {
  const root = asRecord(body);
  const batches = asArray(root.batches).length
    ? asArray(root.batches)
    : asArray(root.resourceSpans).length
      ? asArray(root.resourceSpans)
      : asArray(asRecord(root.trace).resourceSpans);
  const spans: RawSpan[] = [];
  for (const batch of batches) {
    const record = asRecord(batch);
    const service =
      asArray(asRecord(record.resource).attributes)
        .map(asRecord)
        .find(attribute => attribute.key === 'service.name')?.value ?? {};
    const serviceName = asRecord(service).stringValue ?? 'unknown';
    const scopes = [...asArray(record.scopeSpans), ...asArray(record.instrumentationLibrarySpans)];
    for (const scope of scopes)
      for (const raw of asArray(asRecord(scope).spans)) {
        const span = asRecord(raw);
        const start = Number(String(span.startTimeUnixNano ?? '0').slice(0, -6));
        const end = Number(String(span.endTimeUnixNano ?? '0').slice(0, -6));
        const status = asRecord(span.status).code;
        spans.push({
          traceId: String(span.traceId ?? ''),
          spanId: String(span.spanId ?? ''),
          parentId: span.parentSpanId ? String(span.parentSpanId) : null,
          service: serviceName,
          name: span.name,
          startMs: start,
          durationMs: Math.max(0, end - start),
          error: status === 2 || status === 'STATUS_CODE_ERROR',
        });
      }
  }
  return spans;
}

const TRACE_ID = /^[0-9a-f]{16,32}$/i;

async function tempoTraces(context: AdapterContext, query: TracesQuery) {
  const http = httpFor(context, bearerOrBasic(context.connection.credential));
  if (query.traceId) {
    if (!TRACE_ID.test(query.traceId))
      throw new ConnectorError('INVALID_RESPONSE', 'Not a valid trace id');
    const body = await http.getJson(`/api/traces/${query.traceId}`);
    return summarizeTraces(
      query.window,
      otlpSpans(body).map(span => ({ ...span, traceId: query.traceId! }))
    );
  }
  const body = await http.getJson('/api/search', {
    query: {
      q: query.query || '{ status = error }',
      start: seconds(query.window.start),
      end: seconds(query.window.end),
      limit: 5,
    },
  });
  // A search returns one root summary per trace; the model can then ask for one trace by id.
  const roots: RawSpan[] = asArray(asRecord(body).traces).map(item => {
    const trace = asRecord(item);
    return {
      traceId: String(trace.traceID ?? trace.traceId ?? ''),
      spanId: 'root',
      service: trace.rootServiceName,
      name: trace.rootTraceName,
      startMs: Number(String(trace.startTimeUnixNano ?? '0').slice(0, -6)),
      durationMs: Number(trace.durationMs ?? 0),
      error: false,
    };
  });
  return summarizeTraces(query.window, roots);
}

export const prometheusAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, bearerOrBasic(context.connection.credential)).getJson(
      '/api/v1/status/buildinfo'
    );
  },
  metrics: (context, query) => promRange(context, '', query),
};

export const lokiAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, bearerOrBasic(context.connection.credential)).getJson(
      '/loki/api/v1/labels'
    );
  },
  logs: (context, query) => lokiRange(context, '', query),
};

export const tempoAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, bearerOrBasic(context.connection.credential)).getText('/api/echo');
  },
  traces: tempoTraces,
};

const proxy = (context: AdapterContext) =>
  `/api/datasources/proxy/uid/${encodeURIComponent(context.connection.project ?? '')}`;

export const grafanaAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, {
      ...bearerOrBasic(context.connection.credential),
      ...grafanaOrg(context),
    }).getJson(`/api/datasources/uid/${encodeURIComponent(context.connection.project ?? '')}`);
  },
  metrics: (context, query) => promRange(context, proxy(context), query),
  logs: (context, query) => lokiRange(context, proxy(context), query),
};
