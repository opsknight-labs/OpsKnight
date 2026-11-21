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

export interface KubernetesQuery {
  /** Validated DNS-1123 label. */
  namespace: string;
  /** Validated Kubernetes label selector, for workloads and pods. */
  labelSelector?: string;
}

export interface KubernetesSummary {
  namespace: string;
  workloads: Array<{
    kind: string;
    name: string;
    desired: number;
    ready: number;
    updated: number;
    available: number;
    rollout: 'complete' | 'progressing' | 'stalled';
    message?: string;
  }>;
  pods: Array<{
    name: string;
    phase: string;
    ready: boolean;
    restarts: number;
    reason?: string;
    lastTermination?: string;
  }>;
  events: Array<{
    at: string | null;
    type: string;
    reason: string;
    object: string;
    message: string;
    count: number;
  }>;
  truncated: { workloads: boolean; pods: boolean; events: boolean };
}

export interface PipelineQuery {
  /** Validated owner/repo (GitHub) or namespaced project path (GitLab). */
  repository: string;
  branch?: string;
  /** A numeric run (GitHub) or pipeline (GitLab) id: that run and its failed jobs instead of the list. */
  runId?: string;
}

export interface PipelineSummary {
  provider: 'github_actions' | 'gitlab_ci';
  repository: string;
  runs: Array<{
    id: string;
    name: string;
    branch: string;
    sha: string;
    event: string;
    status: string;
    conclusion: string | null;
    startedAt: string | null;
    updatedAt: string | null;
    url: string;
  }>;
  failedJobs?: Array<{
    id: string;
    name: string;
    conclusion: string;
    failedSteps: string[];
    url: string;
    logTail: string;
  }>;
  truncated?: { failedJobs: boolean };
}

export interface ChangeRef {
  provider: 'github' | 'gitlab' | 'azure';
  host: string;
  /** owner/repo for GitHub, the full namespaced path for GitLab, project/repo for Azure DevOps. */
  repository: string;
  type: 'commit' | 'pull' | 'compare' | 'merge_request';
  /** Commit sha, pull/merge request number, or base...head for compare. */
  id: string;
  url: string;
}

/** Validated names only: Azure DevOps project and repository, optional branch (without refs/heads/). */
export interface RepositoryQuery {
  project: string;
  repository: string;
  branch?: string;
}
export interface AzurePipelineQuery {
  project: string;
  pipelineId?: number;
  branch?: string;
}
/** Argo CD: one application (validated name), or the application list when absent. */
export interface DeploymentQuery {
  app?: string;
  appNamespace?: string;
}
/** APM rollups: KPIs for one service, its dependencies, or the whole topology. */
export interface ApmQuery {
  view: 'kpis' | 'dependencies' | 'topology' | 'services';
  service?: string;
  window: TimeWindow;
}
/** Bounded, JSON-shaped summaries of the delivery and APM reads; redaction happens in the tool runner. */
export type ReadSummary = Record<string, unknown>;

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
  /** Metric names starting with a prefix (Prometheus-compatible backends only). */
  metricNames?(context: AdapterContext, prefix: string): Promise<string[]>;
  /** Values one label takes on one metric (Prometheus-compatible backends only). */
  labelValues?(context: AdapterContext, metric: string, label: string): Promise<string[]>;
  kubernetes?(context: AdapterContext, query: KubernetesQuery): Promise<KubernetesSummary>;
  pipelines?(context: AdapterContext, query: PipelineQuery): Promise<PipelineSummary>;
  /** Recent commits and pull requests on a repository branch (Azure DevOps). */
  repository?(context: AdapterContext, query: RepositoryQuery): Promise<ReadSummary>;
  /** Recent pipeline runs, the newest failure's failed records and a log tail (Azure Pipelines). */
  azurePipelines?(context: AdapterContext, query: AzurePipelineQuery): Promise<ReadSummary>;
  /** Application sync, health, deploy history and resource health (Argo CD). */
  deployments?(context: AdapterContext, query: DeploymentQuery): Promise<ReadSummary>;
  /** Service KPIs and topology (base14 Scout APM). */
  apm?(context: AdapterContext, query: ApmQuery): Promise<ReadSummary>;
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
