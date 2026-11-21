import { createHash } from 'node:crypto';
import { KIND_DEFAULT_BASE_URL } from '../contract';
import { ConnectorError } from '../http';
import {
  summarizeLogs,
  summarizeSeries,
  summarizeTraces,
  windowView,
  type RawLogLine,
  type RawSeries,
  type RawSpan,
  type TimeWindow,
} from '../normalize';
import {
  asArray,
  asRecord,
  httpFor,
  type AdapterContext,
  type ApmQuery,
  type ConnectorAdapter,
  type LogsQuery,
  type MetricsQuery,
  type TracesQuery,
} from './types';

/**
 * base14 Scout (OTel-native observability). OAuth2 client credentials: the client ID is stored as the
 * secondary credential, the client secret as the secret, the organization slug in `org`. The access token
 * is cached in process memory until shortly before it expires (never persisted); the organization's Scout
 * API URL comes from the discovery service unless an administrator saved a *.base14.io override. Scout
 * rejects over-wide windows with a 400, so every window is clamped (and logs chunked) client-side.
 */
const DISCOVERY = KIND_DEFAULT_BASE_URL.BASE14_SCOUT as string;
const IDENTITY = 'https://id.base14.io';
const MINUTE = 60_000;
export const SCOUT_MAX_WINDOW_MS = {
  logs: 15 * MINUTE,
  metrics: 60 * MINUTE,
  traces: 24 * 60 * MINUTE,
  services: 60 * MINUTE,
  apm: 30 * 24 * 60 * MINUTE,
} as const;
const MAX_LOOKBACK_MS = 30 * 24 * 60 * MINUTE;
/** Logs are read newest-first in 15-minute chunks; at most this many chunks (one hour) per query. */
const LOG_CHUNKS = 4;
const TRACE_LIMIT = 20;
const EDGES = 50;
const TOKEN_SKEW_MS = 30_000;

interface Session {
  token: string;
  expiresAt: number;
  apiBase?: string;
}
const sessions = new Map<string, Session>();
/** For tests. */
export const clearScoutSessions = () => sessions.clear();

const sessionKey = (context: AdapterContext) => {
  const { id, org, baseUrl, credential } = context.connection;
  const digest = createHash('sha256')
    .update(`${org}\n${baseUrl}\n${credential.secondary}\n${credential.secret}`)
    .digest('hex');
  return `${id}:${digest}`;
};

/** Only base14's own HTTPS hosts are ever contacted with the token. */
function scoutHost(raw: unknown): string {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new ConnectorError('INVALID_RESPONSE', 'Scout returned an unreadable API address');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(url.hostname === 'base14.io' || url.hostname.endsWith('.base14.io'))
  )
    throw new ConnectorError('BLOCKED', 'This address is not allowed');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const isOverride = (baseUrl: string) => baseUrl.replace(/\/+$/, '') !== DISCOVERY;

async function session(context: AdapterContext, fresh = false): Promise<Session> {
  const { org, baseUrl, credential } = context.connection;
  if (!org || !credential.secret || !credential.secondary)
    throw new ConnectorError('UNSUPPORTED', 'The organization, client ID and secret are required');
  // Validate an override before any request, so a bad address never sees the client secret.
  const override = isOverride(baseUrl) ? scoutHost(baseUrl) : undefined;
  const key = sessionKey(context);
  const cached = sessions.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now() && cached.apiBase) return cached;

  const http = httpFor(context);
  const grant = asRecord(
    await http.postJson('', null, {
      absoluteUrl: `${IDENTITY}/realms/${encodeURIComponent(org)}/protocol/openid-connect/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      rawBody: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credential.secondary,
        client_secret: credential.secret,
      }).toString(),
    })
  );
  if (typeof grant.access_token !== 'string' || !grant.access_token)
    throw new ConnectorError('INVALID_RESPONSE', 'The identity service returned no token');
  const lifetime = Number(grant.expires_in);
  const next: Session = {
    token: grant.access_token,
    expiresAt: Date.now() + (Number.isFinite(lifetime) ? lifetime * 1000 : 60_000) - TOKEN_SKEW_MS,
    apiBase: cached?.apiBase,
  };
  if (!next.apiBase) {
    let root = override;
    if (!root) {
      const found = asRecord(
        await http.getJson('', {
          absoluteUrl: `${DISCOVERY}/v1/discovery/services/${encodeURIComponent(org)}`,
          headers: { authorization: `Bearer ${next.token}` },
        })
      );
      root = scoutHost(found.scoutApiUrl);
    }
    next.apiBase = root.endsWith('/api/v1') ? root : `${root}/api/v1`;
  }
  sessions.set(key, next);
  return next;
}

type Query = Record<string, string | number | undefined>;

/** A GET under the Scout API base; a 401 refreshes the token once (it may have been revoked early). */
async function scoutGet(context: AdapterContext, path: string, query: Query): Promise<unknown> {
  const attempt = async (fresh: boolean) => {
    const current = await session(context, fresh);
    return httpFor(context).getJson('', {
      absoluteUrl: `${current.apiBase}${path}`,
      headers: { authorization: `Bearer ${current.token}` },
      query,
    });
  };
  try {
    return await attempt(false);
  } catch (error) {
    if (error instanceof ConnectorError && error.status === 401) return attempt(true);
    throw error;
  }
}

/** The newest `maxMs` of the window, never older than Scout's 30-day lookback nor in the future. */
export function clampWindow(window: TimeWindow, maxMs: number, now = Date.now()): TimeWindow {
  const end = Math.min(window.end.getTime(), now);
  const start = Math.max(window.start.getTime(), end - maxMs, now - MAX_LOOKBACK_MS + MINUTE);
  if (start >= end)
    throw new ConnectorError('UNSUPPORTED', 'The window is outside Scout retention');
  return { start: new Date(start), end: new Date(end) };
}

const range = (window: TimeWindow) => ({
  start_time: window.start.toISOString(),
  end_time: window.end.toISOString(),
});

const ATTRIBUTE = /^(attr|resource_attr|log_attr|span_attr)_[A-Za-z0-9_.-]{1,100}(\[ne\])?$/;
const SERVICE = /^(?!.*\.\.)[A-Za-z0-9_.:/-]{1,200}$/;
const TOKEN = /([A-Za-z0-9_.[\]-]+)=(?:"([^"]{0,300})"|(\S{0,300}))/g;

/**
 * Parses `service=checkout metric=http.server.duration attr_http.method=GET` style queries into Scout's
 * query parameters. Only the named keys and validated attribute filters of the signal pass; leftover text is
 * the log body search for logs and an error elsewhere.
 */
export function parseScoutQuery(
  raw: string,
  keys: Readonly<Record<string, string>>,
  attributePrefixes: readonly string[],
  freeText?: string
): Query {
  const query: Query = {};
  const rest = raw
    .replace(TOKEN, (_match, key: string, quoted?: string, bare?: string) => {
      const value = quoted ?? bare ?? '';
      const target = Object.hasOwn(keys, key) ? keys[key as keyof typeof keys] : undefined;
      // eslint-disable-next-line security/detect-object-injection -- a fixed parameter name
      if (target) query[target] = value;
      else if (ATTRIBUTE.test(key) && attributePrefixes.some(prefix => key.startsWith(prefix)))
        // eslint-disable-next-line security/detect-object-injection -- validated attribute key
        query[key] = value;
      else throw new ConnectorError('UNSUPPORTED', `Unknown Scout filter ${key.slice(0, 40)}`);
      return ' ';
    })
    .trim();
  if (rest) {
    if (!freeText) throw new ConnectorError('UNSUPPORTED', 'Use key=value filters for Scout');
    // eslint-disable-next-line security/detect-object-injection -- a fixed parameter name
    query[freeText] = rest.slice(0, 300);
  }
  const service = query.service_name;
  if (typeof service !== 'string' || !SERVICE.test(service))
    throw new ConnectorError('UNSUPPORTED', 'A service=<name> filter is required');
  return query;
}

const ms = (value: unknown) => {
  if (typeof value === 'number') return value > 1e15 ? value / 1e6 : value;
  return Date.parse(String(value));
};

async function metricSeries(context: AdapterContext, query: MetricsQuery) {
  const params = parseScoutQuery(
    query.query,
    { service: 'service_name', metric: 'metric_name', group_by: 'group_by' },
    ['attr_', 'resource_attr_']
  );
  if (!params.metric_name)
    throw new ConnectorError('UNSUPPORTED', 'A metric=<name> filter is required');
  const window = clampWindow(query.window, SCOUT_MAX_WINDOW_MS.metrics);
  const body = asRecord(
    await scoutGet(context, '/telemetry/metrics', { ...params, ...range(window) })
  );
  const series: RawSeries[] = asArray(body.series).map(item => {
    const entry = asRecord(item);
    return {
      labels: { __name__: body.metric_name ?? params.metric_name, ...asRecord(entry.group) },
      points: asArray(entry.data_points).flatMap(point => {
        const row = asRecord(point);
        const at = ms(row.bucket);
        const value = Number(row.avg_value);
        return Number.isFinite(at) && Number.isFinite(value)
          ? [[at, value] as [number, number]]
          : [];
      }),
    };
  });
  return { window, series };
}

export const base14Adapter: ConnectorAdapter = {
  async test(context) {
    await scoutGet(context, '/services', {});
  },

  async metrics(context, query) {
    const { window, series } = await metricSeries(context, query);
    return summarizeSeries(query.query, window, series);
  },
  series: async (context, query) => (await metricSeries(context, query)).series,

  async logs(context, query: LogsQuery) {
    const params = parseScoutQuery(
      query.query,
      {
        service: 'service_name',
        severity: 'severity',
        body: 'body_contains',
        trace_id: 'trace_id',
      },
      ['log_attr_', 'resource_attr_'],
      'body_contains'
    );
    const window = clampWindow(query.window, SCOUT_MAX_WINDOW_MS.logs * LOG_CHUNKS);
    const lines: RawLogLine[] = [];
    let end = window.end.getTime();
    while (end > window.start.getTime() && lines.length < query.limit) {
      const start = Math.max(window.start.getTime(), end - SCOUT_MAX_WINDOW_MS.logs);
      const body = asRecord(
        await scoutGet(context, '/telemetry/logs', {
          ...params,
          ...range({ start: new Date(start), end: new Date(end) }),
          limit: query.limit - lines.length,
        })
      );
      for (const item of asArray(body.logs)) {
        const log = asRecord(item);
        lines.push({
          at: ms(log.timestamp),
          text: log.body,
          labels: { severity: log.severity, trace_id: log.trace_id },
        });
      }
      end = start;
    }
    return summarizeLogs(query.query, window, lines);
  },

  async traces(context, query: TracesQuery) {
    const params = parseScoutQuery(
      query.query ?? '',
      { service: 'service_name', span: 'span_name', status: 'status_code', operation: 'operation' },
      ['span_attr_', 'resource_attr_']
    );
    const window = clampWindow(query.window, SCOUT_MAX_WINDOW_MS.traces);
    const toSpan = (item: unknown): RawSpan => {
      const span = asRecord(item);
      return {
        traceId: String(span.trace_id ?? ''),
        spanId: String(span.span_id ?? ''),
        parentId: typeof span.parent_span_id === 'string' ? span.parent_span_id : null,
        service: span.service_name,
        name: span.span_name,
        startMs: ms(span.timestamp),
        durationMs: Number(span.duration_ns) / 1e6,
        error: /error/i.test(String(span.status_code ?? '')),
      };
    };
    if (query.traceId) {
      const body = asRecord(
        await scoutGet(context, `/telemetry/traces/${encodeURIComponent(query.traceId)}`, {
          service_name: params.service_name,
          ...range(window),
        })
      );
      return summarizeTraces(window, asArray(body.spans).map(toSpan));
    }
    const body = asRecord(
      await scoutGet(context, '/telemetry/traces', {
        ...params,
        ...range(window),
        limit: TRACE_LIMIT,
      })
    );
    return summarizeTraces(window, asArray(body.data).map(toSpan));
  },

  async apm(context, query: ApmQuery) {
    const edges = (value: unknown) => {
      const all = asArray(value).map(asRecord);
      return {
        dependencies: all.slice(0, EDGES).map(edge => ({
          source: edge.source,
          target: edge.target,
          type: edge.relationship_type ?? null,
          span: edge.span_name ?? null,
          lastSeen: edge.last_noticed ?? null,
        })),
        total: all.length,
        truncated: all.length > EDGES,
      };
    };
    if (query.view === 'kpis') {
      const window = clampWindow(query.window, SCOUT_MAX_WINDOW_MS.apm);
      const body = asRecord(
        await scoutGet(context, '/apm/kpis', { service_name: query.service, ...range(window) })
      );
      return {
        kind: 'apm',
        view: 'kpis',
        service: query.service,
        window: windowView(window),
        summary: asRecord(body.summary),
      };
    }
    const window = clampWindow(query.window, SCOUT_MAX_WINDOW_MS.services);
    if (query.view === 'services') {
      const all = asArray(asRecord(await scoutGet(context, '/services', range(window))).services);
      return {
        kind: 'apm',
        view: 'services',
        window: windowView(window),
        services: all.slice(0, EDGES).map(String),
        total: all.length,
        truncated: all.length > EDGES,
      };
    }
    const path =
      query.view === 'dependencies'
        ? `/services/${encodeURIComponent(query.service ?? '')}/dependencies`
        : '/services/topology';
    const body = asRecord(await scoutGet(context, path, range(window)));
    return {
      kind: 'apm',
      view: query.view,
      service: query.service ?? null,
      window: windowView(window),
      ...edges(body.dependencies),
    };
  },
};
