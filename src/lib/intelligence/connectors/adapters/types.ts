import type { ObservabilityKind } from '../contract';
import { createConnectorHttp, type ConnectorFetch, type ConnectorHttp } from '../http';
import type {
  DiffSummary,
  ErrorsSummary,
  LogsSummary,
  MetricsSummary,
  RawSeries,
  TimeWindow,
  TracesSummary,
} from '../normalize';

/** Decrypted credential parts. Lives only in server memory for the duration of one request. */
export interface ConnectorCredential {
  secret?: string;
  secondary?: string;
}

export interface ResolvedConnection {
  id: string;
  name: string;
  kind: ObservabilityKind;
  baseUrl: string;
  region: string | null;
  org: string | null;
  project: string | null;
  allowPrivateNetwork: boolean;
  timeoutMs: number;
  credential: ConnectorCredential;
}

export interface AdapterContext {
  connection: ResolvedConnection;
  /** Always the guarded fetch in production; injected in tests. */
  fetch: ConnectorFetch;
  signal?: AbortSignal;
}

export interface MetricsQuery {
  query: string;
  window: TimeWindow;
  stepSeconds?: number;
}
export interface LogsQuery {
  query: string;
  window: TimeWindow;
  limit: number;
}
export interface TracesQuery {
  traceId?: string;
  query?: string;
  window: TimeWindow;
}
export interface ErrorsQuery {
  query?: string;
  window: TimeWindow;
}

export interface ChangeRef {
  provider: 'github' | 'gitlab';
  host: string;
  /** owner/repo for GitHub, the full namespaced path for GitLab. */
  repository: string;
  type: 'commit' | 'pull' | 'compare' | 'merge_request';
  /** Commit sha, pull/merge request number, or base...head for compare. */
  id: string;
  url: string;
}

/** One small adapter per kind: a typed query in, a bounded summary out. Unsupported capabilities are absent. */
export interface ConnectorAdapter {
  /** A harmless read that proves the address and credential work. */
  test(context: AdapterContext): Promise<void>;
  metrics?(context: AdapterContext, query: MetricsQuery): Promise<MetricsSummary>;
  /**
   * The same metrics query as raw points, for lane-side analysis (metric anomaly evidence). Never handed to a
   * model; the caller bounds series and points itself. Present exactly where `metrics` is.
   */
  series?(context: AdapterContext, query: MetricsQuery): Promise<RawSeries[]>;
  logs?(context: AdapterContext, query: LogsQuery): Promise<LogsSummary>;
  traces?(context: AdapterContext, query: TracesQuery): Promise<TracesSummary>;
  errors?(context: AdapterContext, query: ErrorsQuery): Promise<ErrorsSummary>;
  diff?(context: AdapterContext, ref: ChangeRef): Promise<DiffSummary>;
}

export function httpFor(
  context: AdapterContext,
  headers: Record<string, string> = {},
  extra: Partial<Parameters<typeof createConnectorHttp>[0]> = {}
): ConnectorHttp {
  return createConnectorHttp({
    baseUrl: context.connection.baseUrl,
    fetch: context.fetch,
    timeoutMs: context.connection.timeoutMs,
    signal: context.signal,
    headers,
    ...extra,
  });
}

/** Basic auth when a user name is stored with the secret, a bearer token otherwise, nothing without one. */
export function bearerOrBasic(credential: ConnectorCredential): Record<string, string> {
  if (credential.secret && credential.secondary)
    return {
      authorization: `Basic ${Buffer.from(`${credential.secondary}:${credential.secret}`).toString('base64')}`,
    };
  if (credential.secret) return { authorization: `Bearer ${credential.secret}` };
  return {};
}

export const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** A step that yields about 120 points across the window, never under 15 seconds. */
export const autoStep = (window: { start: Date; end: Date }, requested?: number) =>
  Math.max(
    15,
    requested ?? 0,
    Math.ceil((window.end.getTime() - window.start.getTime()) / 1000 / 120)
  );

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
