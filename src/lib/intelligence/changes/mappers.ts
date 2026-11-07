/**
 * Pure mappers from native change-source webhooks to OpsKnight change inputs. Each returns null when
 * the payload is not a change worth recording (a sync that is still in progress, a flag read, a plan).
 * They never throw on unexpected shapes: a missing field degrades to a generic summary.
 */

export interface MappedChange {
  source: string;
  kind: 'DEPLOY' | 'CONFIG' | 'FEATURE_FLAG' | 'INFRA';
  summary: string;
  version?: string;
  component?: string;
  labels: Record<string, string | number | boolean>;
  url?: string;
  dedupKey: string;
  occurredAt: string | number | Date;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const str = (value: unknown, max = 300): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const label = (into: Record<string, string | number | boolean>, key: string, value: unknown) => {
  if (typeof value === 'string' && value.trim())
    Object.assign(into, { [key]: value.trim().slice(0, 128) });
  else if (typeof value === 'number' || typeof value === 'boolean')
    Object.assign(into, { [key]: value });
};

/** Argo CD notification webhook (the default `app` template). Only finished syncs are recorded. */
export function mapArgoCdChange(payload: unknown): MappedChange | null {
  const body = obj(payload);
  const app = obj(body.app);
  const metadata = obj(app.metadata);
  const status = obj(app.status);
  const sync = obj(status.sync);
  const operation = obj(status.operationState);
  const name = str(metadata.name) ?? str(body.application) ?? str(body.app_name);
  if (!name) return null;
  const phase = str(operation.phase) ?? str(body.phase);
  const finishedAt = str(operation.finishedAt) ?? str(body.finishedAt);
  if (phase && !['Succeeded', 'Failed', 'Error'].includes(phase)) return null;
  const revision = str(sync.revision) ?? str(body.revision, 100);
  const labels: Record<string, string | number | boolean> = {};
  label(labels, 'namespace', metadata.namespace ?? obj(app.spec).project);
  label(labels, 'project', obj(app.spec).project);
  label(labels, 'phase', phase);
  label(labels, 'syncStatus', sync.status);
  const destination = obj(obj(app.spec).destination);
  label(labels, 'cluster', destination.name ?? destination.server);
  label(labels, 'environment', obj(metadata.labels).environment ?? obj(metadata.labels).env);
  return {
    source: 'argocd',
    kind: 'DEPLOY',
    summary: `Argo CD sync ${name}${phase ? ` ${phase.toLowerCase()}` : ''}${revision ? ` at ${revision.slice(0, 12)}` : ''}`,
    version: revision?.slice(0, 100),
    component: name,
    labels,
    url: str(body.url, 500),
    dedupKey: `${name}:${revision ?? 'unknown'}:${finishedAt ?? phase ?? 'sync'}`,
    occurredAt: finishedAt ?? new Date(),
  };
}

/** LaunchDarkly webhook (audit-log entries). Flag and segment changes become FEATURE_FLAG changes. */
export function mapLaunchDarklyChange(payload: unknown): MappedChange | null {
  const body = obj(payload);
  const kind = str(body.kind);
  if (kind && !['flag', 'segment'].includes(kind)) return null;
  const accesses = Array.isArray(body.accesses) ? body.accesses.map(obj) : [];
  const resource = str(accesses[0]?.resource, 300) ?? '';
  // proj/<project>:env/<environment>:flag/<key>
  const project = /proj\/([^:]+)/.exec(resource)?.[1];
  const environment = /env\/([^:]+)/.exec(resource)?.[1];
  const flag = /(?:flag|segment)\/([^:]+)$/.exec(resource)?.[1] ?? str(body.name, 128);
  if (!flag) return null;
  const labels: Record<string, string | number | boolean> = {};
  label(labels, 'project', project);
  label(labels, 'environment', environment);
  label(labels, 'action', accesses[0]?.action);
  label(labels, 'actor', obj(body.member).email ?? obj(body.member)._id);
  const id = str(body._id, 128) ?? `${flag}:${String(body.date ?? Date.now())}`;
  return {
    source: 'launchdarkly',
    kind: 'FEATURE_FLAG',
    summary: str(body.title) ?? `${str(body.titleVerb) ?? 'changed'} ${flag}`,
    component: flag,
    labels,
    url: str(obj(body._links).site, 500) ?? str(body.url, 500),
    dedupKey: id,
    occurredAt: typeof body.date === 'number' ? body.date : new Date(),
  };
}

/** Unleash webhook addon. Feature toggle events become FEATURE_FLAG changes. */
export function mapUnleashChange(payload: unknown): MappedChange | null {
  const body = obj(payload);
  const type = str(body.type, 64);
  const feature = str(body.featureName, 128) ?? str(obj(body.data).name, 128);
  if (!feature) return null;
  if (type && /-(?:read|viewed|fetched)$/.test(type)) return null;
  const labels: Record<string, string | number | boolean> = {};
  label(labels, 'project', body.project);
  label(labels, 'environment', body.environment);
  label(labels, 'event', type);
  label(labels, 'actor', body.createdBy);
  const id =
    body.id !== undefined ? String(body.id) : `${feature}:${str(body.createdAt) ?? Date.now()}`;
  return {
    source: 'unleash',
    kind: 'FEATURE_FLAG',
    summary: `${type ? type.replace(/-/g, ' ') : 'feature changed'}: ${feature}`,
    component: feature,
    labels,
    dedupKey: id,
    occurredAt: str(body.createdAt) ?? new Date(),
  };
}

/** HCP Terraform / Terraform Enterprise run notifications. Applied and errored runs become INFRA changes. */
export function mapTerraformChange(payload: unknown): MappedChange | null {
  const body = obj(payload);
  const runId = str(body.run_id, 64);
  const notifications = Array.isArray(body.notifications) ? body.notifications.map(obj) : [];
  const latest = notifications[notifications.length - 1] ?? {};
  const status = str(latest.run_status, 64) ?? str(body.run_status, 64);
  if (!runId || !status) return null;
  if (!['applied', 'errored', 'canceled', 'force_canceled', 'discarded'].includes(status))
    return null;
  if (status !== 'applied' && status !== 'errored') return null;
  const workspace = str(body.workspace_name, 128);
  const labels: Record<string, string | number | boolean> = {};
  label(labels, 'organization', body.organization_name);
  label(labels, 'workspace', workspace);
  label(labels, 'status', status);
  label(labels, 'trigger', latest.trigger);
  return {
    source: 'terraform',
    kind: 'INFRA',
    summary: `Terraform run ${status}${workspace ? ` in ${workspace}` : ''}${str(body.run_message) ? `: ${str(body.run_message, 200)}` : ''}`,
    version: runId,
    component: workspace,
    labels,
    url: str(body.run_url, 500),
    dedupKey: `${runId}:${status}`,
    occurredAt: str(latest.run_updated_at) ?? new Date(),
  };
}
