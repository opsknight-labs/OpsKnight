/**
 * Pure mappers for deploy webhooks from GitHub, GitLab and Kubernetes rollouts. Same contract as
 * `mappers.ts`: null when the payload is not a finished change, never a throw on an unexpected shape.
 * Where the source says when the change began it is kept in the `startedAt` label.
 */
import type { MappedChange } from './mappers';

type Json = Record<string, unknown>;
type Labels = MappedChange['labels'];
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const str = (value: unknown, max = 300): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const label = (into: Labels, key: string, value: unknown) => {
  if (typeof value === 'string' && value.trim())
    Object.assign(into, { [key]: value.trim().slice(0, 128) });
  else if (typeof value === 'number' || typeof value === 'boolean')
    Object.assign(into, { [key]: value });
};

/**
 * GitHub `deployment_status` webhook. Only terminal states are recorded; the deployment's creation time is
 * the start. A bare `deployment` event (created, no outcome yet) returns null: its statuses follow and
 * carry the same deployment, so recording both would duplicate one deploy.
 */
export function mapGitHubDeploymentChange(payload: unknown): MappedChange | null {
  const body = obj(payload);
  const status = obj(body.deployment_status);
  const deployment = obj(body.deployment);
  const repository = obj(body.repository);
  const state = str(status.state, 32);
  if (!state || !['success', 'failure', 'error'].includes(state)) return null;
  const repo = str(repository.full_name, 128) ?? str(repository.name, 128);
  const id = deployment.id ?? status.deployment_id;
  if (!repo || (typeof id !== 'number' && typeof id !== 'string')) return null;
  const sha = str(deployment.sha, 100);
  const environment = str(status.environment, 128) ?? str(deployment.environment, 128);
  const labels: Labels = {};
  label(labels, 'repository', repo);
  label(labels, 'environment', environment);
  label(labels, 'state', state);
  label(labels, 'ref', deployment.ref);
  label(labels, 'actor', obj(status.creator).login ?? obj(deployment.creator).login);
  label(labels, 'startedAt', deployment.created_at);
  return {
    source: 'github',
    kind: 'DEPLOY',
    summary: `GitHub deploy ${repo}${environment ? ` to ${environment}` : ''} ${state}${sha ? ` at ${sha.slice(0, 12)}` : ''}`,
    version: sha,
    component: str(repository.name, 128) ?? repo,
    labels,
    url: str(status.target_url, 500) ?? str(status.log_url, 500) ?? str(repository.html_url, 500),
    dedupKey: `${repo}:${id}`.slice(0, 128),
    occurredAt: str(status.created_at) ?? str(status.updated_at) ?? new Date(),
  };
}

/** GitLab times look like `2021-04-28 21:50:00 +0200` or `... UTC`; ISO-8601 is parsed everywhere. */
function gitlabTime(value: unknown): string | undefined {
  const text = str(value, 64);
  const match =
    text && /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (?:([+-]\d{2})(\d{2})|UTC)$/.exec(text);
  if (!match) return text;
  return `${match[1]}T${match[2]}${match[3] ? `${match[3]}:${match[4]}` : 'Z'}`;
}

/** GitLab deployment event. Finished (success or failed) deployments become DEPLOY changes. */
export function mapGitLabDeploymentChange(payload: unknown): MappedChange | null {
  const body = obj(payload);
  if (str(body.object_kind) && body.object_kind !== 'deployment') return null;
  const status = str(body.status, 32);
  if (status !== 'success' && status !== 'failed') return null;
  const project = obj(body.project);
  const path = str(project.path_with_namespace, 128) ?? str(project.name, 128);
  const id = body.deployment_id;
  if (!path || (typeof id !== 'number' && typeof id !== 'string')) return null;
  const environment = str(body.environment, 128);
  const sha = str(body.short_sha, 100);
  const labels: Labels = {};
  label(labels, 'project', path);
  label(labels, 'environment', environment);
  label(labels, 'tier', body.environment_tier);
  label(labels, 'status', status);
  label(labels, 'ref', body.ref);
  label(labels, 'actor', obj(body.user).username);
  return {
    source: 'gitlab',
    kind: 'DEPLOY',
    summary: `GitLab deploy ${path}${environment ? ` to ${environment}` : ''} ${status}${sha ? ` at ${sha}` : ''}${str(body.commit_title) ? `: ${str(body.commit_title, 150)}` : ''}`,
    version: sha,
    component: str(project.name, 128) ?? path,
    labels,
    url: str(body.deployable_url, 500) ?? str(body.commit_url, 500),
    dedupKey: `${path}:${id}:${status}`.slice(0, 128),
    occurredAt: gitlabTime(body.status_changed_at) ?? new Date(),
  };
}

const ROLLOUT_OUTCOMES = new Map([
  ['RolloutCompleted', 'completed'],
  ['RolloutAborted', 'aborted'],
]);

/**
 * Kubernetes rollout from a generic event forwarder (kubernetes-event-exporter or similar): the forwarded
 * core/v1 Event about an Argo Rollouts `Rollout`. Completed and aborted rollouts become DEPLOY changes; the
 * component is the workload's `app.kubernetes.io/name` or `app` label, else its name.
 */
export function mapKubernetesRolloutChange(payload: unknown): MappedChange | null {
  const body = obj(payload);
  const reason = str(body.reason, 64);
  const outcome = reason ? ROLLOUT_OUTCOMES.get(reason) : undefined;
  if (!outcome) return null;
  const involved = obj(body.involvedObject);
  const name = str(involved.name, 128);
  if (!name) return null;
  const namespace = str(involved.namespace, 128) ?? str(obj(body.metadata).namespace, 128);
  const workloadLabels = obj(involved.labels);
  const revision = str(obj(involved.annotations)['rollout.argoproj.io/revision'], 32);
  const when =
    str(body.lastTimestamp) ?? str(body.eventTime) ?? str(obj(body.metadata).creationTimestamp);
  const labels: Labels = {};
  label(labels, 'namespace', namespace);
  label(labels, 'workload', `${str(involved.kind, 64) ?? 'Rollout'}/${name}`);
  label(labels, 'reason', reason);
  label(labels, 'cluster', body.clusterName ?? body.cluster);
  label(labels, 'environment', workloadLabels.environment ?? workloadLabels.env);
  label(labels, 'app', workloadLabels['app.kubernetes.io/name'] ?? workloadLabels.app);
  return {
    source: 'kubernetes',
    kind: 'DEPLOY',
    summary: `Rollout ${namespace ? `${namespace}/` : ''}${name} ${outcome}${revision ? ` (revision ${revision})` : ''}${str(body.message) ? `: ${str(body.message, 150)}` : ''}`,
    version: revision,
    component:
      str(workloadLabels['app.kubernetes.io/name'], 128) ?? str(workloadLabels.app, 128) ?? name,
    labels,
    dedupKey: `${namespace ?? ''}/${name}:${revision ?? when ?? 'rollout'}:${reason}`.slice(0, 128),
    occurredAt: when ?? new Date(),
  };
}
