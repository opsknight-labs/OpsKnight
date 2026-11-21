import {
  asArray,
  asRecord,
  bearerOrBasic,
  httpFor,
  type AdapterContext,
  type ConnectorAdapter,
  type KubernetesQuery,
  type KubernetesSummary,
} from './types';

/*
 * Read-only Kubernetes API reads with a bearer token (a service account bound to the built-in `view`
 * ClusterRole is enough). Only status, never specs, so container env and mounted secrets are never read.
 */

export const K8S_LIMITS = { workloads: 15, pods: 10, events: 15, listed: 200, text: 200 } as const;

const WORKLOAD_PATHS = [
  ['Deployment', 'apis/apps/v1', 'deployments'],
  ['StatefulSet', 'apis/apps/v1', 'statefulsets'],
  ['DaemonSet', 'apis/apps/v1', 'daemonsets'],
] as const;

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const text = (value: unknown, max: number = K8S_LIMITS.text) => {
  const string = typeof value === 'string' ? value : '';
  return string.length > max ? `${string.slice(0, max - 1)}…` : string;
};

async function list(
  context: AdapterContext,
  path: string,
  labelSelector?: string
): Promise<Record<string, unknown>[]> {
  const http = httpFor(context, bearerOrBasic(context.connection.credential));
  const body = await http.getJson(path, {
    query: { limit: K8S_LIMITS.listed, labelSelector: labelSelector || undefined },
  });
  return asArray(asRecord(body).items).map(asRecord);
}

function workload(kind: string, item: Record<string, unknown>) {
  const meta = asRecord(item.metadata);
  const status = asRecord(item.status);
  const spec = asRecord(item.spec);
  const daemon = kind === 'DaemonSet';
  const desired = daemon ? num(status.desiredNumberScheduled) : num(spec.replicas ?? 1);
  const ready = daemon ? num(status.numberReady) : num(status.readyReplicas);
  const updated = daemon ? num(status.updatedNumberScheduled) : num(status.updatedReplicas);
  const available = daemon ? num(status.numberAvailable) : num(status.availableReplicas);
  const conditions = asArray(status.conditions).map(asRecord);
  const stalled = conditions.find(
    condition => condition.type === 'Progressing' && condition.reason === 'ProgressDeadlineExceeded'
  );
  const observed = num(status.observedGeneration) >= num(meta.generation);
  const rollout: KubernetesSummary['workloads'][number]['rollout'] = stalled
    ? 'stalled'
    : observed && updated >= desired && ready >= desired && available >= desired
      ? 'complete'
      : 'progressing';
  return {
    kind,
    name: text(meta.name, 120),
    desired,
    ready,
    updated,
    available,
    rollout,
    ...(stalled ? { message: text(stalled.message) } : {}),
  };
}

function pod(item: Record<string, unknown>) {
  const status = asRecord(item.status);
  const containers = asArray(status.containerStatuses).map(asRecord);
  const waiting = containers
    .map(container => asRecord(asRecord(container.state).waiting).reason)
    .find(reason => typeof reason === 'string');
  const terminated = containers
    .map(container => asRecord(asRecord(container.lastState).terminated).reason)
    .find(reason => typeof reason === 'string');
  return {
    name: text(asRecord(item.metadata).name, 120),
    phase: text(status.phase, 40) || 'Unknown',
    ready: containers.length > 0 && containers.every(container => container.ready === true),
    restarts: containers.reduce((sum, container) => sum + num(container.restartCount), 0),
    ...(waiting ? { reason: text(waiting, 60) } : {}),
    ...(terminated ? { lastTermination: text(terminated, 60) } : {}),
  };
}

function event(item: Record<string, unknown>) {
  const involved = asRecord(item.involvedObject);
  const at =
    [item.lastTimestamp, item.eventTime, item.firstTimestamp].find(
      value => typeof value === 'string' && value
    ) ?? null;
  return {
    at: at as string | null,
    type: text(item.type, 20),
    reason: text(item.reason, 60),
    object: `${text(involved.kind, 30)}/${text(involved.name, 120)}`,
    message: text(item.message),
    count: num(item.count) || 1,
  };
}

async function kubernetesState(
  context: AdapterContext,
  query: KubernetesQuery
): Promise<KubernetesSummary> {
  const ns = `namespaces/${encodeURIComponent(query.namespace)}`;
  const [workloadLists, pods, events] = await Promise.all([
    Promise.all(
      WORKLOAD_PATHS.map(([kind, group, plural]) =>
        list(context, `/${group}/${ns}/${plural}`, query.labelSelector).then(items =>
          items.map(item => workload(kind, item))
        )
      )
    ),
    list(context, `/api/v1/${ns}/pods`, query.labelSelector).then(items => items.map(pod)),
    list(context, `/api/v1/${ns}/events`).then(items => items.map(event)),
  ]);
  // Unhealthy first: stalled or progressing rollouts, then pods by restarts and readiness, newest events.
  const rank = { stalled: 0, progressing: 1, complete: 2 } as const;
  const workloads = workloadLists
    .flat()
    .sort((a, b) => rank[a.rollout] - rank[b.rollout] || a.name.localeCompare(b.name));
  const unhealthy = pods
    .filter(item => item.restarts > 0 || !item.ready)
    .sort((a, b) => b.restarts - a.restarts || Number(a.ready) - Number(b.ready));
  const recent = events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return {
    namespace: query.namespace,
    workloads: workloads.slice(0, K8S_LIMITS.workloads),
    pods: unhealthy.slice(0, K8S_LIMITS.pods),
    events: recent.slice(0, K8S_LIMITS.events),
    truncated: {
      workloads: workloads.length > K8S_LIMITS.workloads,
      pods: unhealthy.length > K8S_LIMITS.pods,
      events: recent.length > K8S_LIMITS.events,
    },
  };
}

export const kubernetesAdapter: ConnectorAdapter = {
  // `/version` is often public, so the test lists one namespace: it proves the token, not only the address.
  async test(context) {
    await httpFor(context, bearerOrBasic(context.connection.credential)).getJson(
      '/api/v1/namespaces',
      { query: { limit: 1 } }
    );
  },
  kubernetes: kubernetesState,
};
