import {
  summarizeLogs,
  summarizeSeries,
  summarizeTraces,
  type RawSeries,
  type RawSpan,
} from '../normalize';
import {
  asArray,
  asRecord,
  httpFor,
  seconds,
  type AdapterContext,
  type ConnectorAdapter,
  type MetricsQuery,
} from './types';

/** Datadog authenticates with an API key and an application key, both stored encrypted. */
function headers(context: AdapterContext): Record<string, string> {
  const { secret, secondary } = context.connection.credential;
  return {
    ...(secret ? { 'dd-api-key': secret } : {}),
    ...(secondary ? { 'dd-application-key': secondary } : {}),
  };
}

async function ddSeries(context: AdapterContext, query: MetricsQuery): Promise<RawSeries[]> {
  const body = await httpFor(context, headers(context)).getJson('/api/v1/query', {
    query: {
      from: seconds(query.window.start),
      to: seconds(query.window.end),
      query: query.query,
    },
  });
  const series = asArray(asRecord(body).series).map(item => {
    const entry = asRecord(item);
    return {
      labels: { metric: entry.metric, scope: entry.scope },
      points: asArray(entry.pointlist).flatMap(point => {
        const pair = asArray(point);
        const at = Number(pair[0]);
        const value = Number(pair[1]);
        return pair[1] !== null && Number.isFinite(at) && Number.isFinite(value)
          ? [[at, value] as [number, number]]
          : [];
      }),
    };
  });
  return series;
}

const TRACE_ID = /^[0-9a-f]{1,32}$/i;

export const datadogAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, headers(context)).getJson('/api/v1/validate');
  },

  async metrics(context, query) {
    return summarizeSeries(query.query, query.window, await ddSeries(context, query));
  },

  series: (context, query) => ddSeries(context, query),

  async logs(context, query) {
    const body = await httpFor(context, headers(context)).postJson('/api/v2/logs/events/search', {
      filter: {
        query: query.query,
        from: query.window.start.toISOString(),
        to: query.window.end.toISOString(),
      },
      sort: '-timestamp',
      page: { limit: query.limit },
    });
    const lines = asArray(asRecord(body).data).map(item => {
      const attributes = asRecord(asRecord(item).attributes);
      return {
        at: Date.parse(String(attributes.timestamp ?? '')),
        text: attributes.message,
        labels: { service: attributes.service, status: attributes.status, host: attributes.host },
      };
    });
    return summarizeLogs(query.query, query.window, lines);
  },

  async traces(context, query) {
    const filter =
      query.traceId && TRACE_ID.test(query.traceId)
        ? `trace_id:${query.traceId}`
        : query.query || 'status:error';
    const body = await httpFor(context, headers(context)).getJson('/api/v2/spans/events', {
      query: {
        'filter[query]': filter,
        'filter[from]': query.window.start.toISOString(),
        'filter[to]': query.window.end.toISOString(),
        'page[limit]': 100,
        sort: '-timestamp',
      },
    });
    const spans: RawSpan[] = asArray(asRecord(body).data).map(item => {
      const attributes = asRecord(asRecord(item).attributes);
      const start = Date.parse(String(attributes.start_timestamp ?? ''));
      const end = Date.parse(String(attributes.end_timestamp ?? ''));
      return {
        traceId: String(attributes.trace_id ?? ''),
        spanId: String(attributes.span_id ?? ''),
        parentId:
          attributes.parent_id && attributes.parent_id !== '0'
            ? String(attributes.parent_id)
            : null,
        service: attributes.service,
        name: attributes.resource_name ?? attributes.operation_name,
        startMs: start,
        durationMs: Number.isFinite(end - start) ? end - start : 0,
        error: attributes.status === 'error' || attributes.error === true,
      };
    });
    return summarizeTraces(query.window, spans);
  },
};
