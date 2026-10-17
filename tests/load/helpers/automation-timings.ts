import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parsePrometheusText, scrapePrometheusEndpoint } from './metrics';

const exec = promisify(execFile);
export const COMPONENT_METRICS = new Map([
  ['versionLoad', 'opsknight_automation_version_load_ms'],
  ['extraction', 'opsknight_automation_extraction_duration_ms'],
  ['evaluator', 'opsknight_automation_evaluator_ms'],
  ['policyLookup', 'opsknight_automation_policy_lookup_ms'],
  ['responderSnapshot', 'opsknight_automation_responder_snapshot_ms'],
  ['decisionPersistence', 'opsknight_automation_decision_persistence_ms'],
  ['tracePersistence', 'opsknight_automation_trace_persistence_ms'],
  ['incidentTransaction', 'opsknight_event_transaction_duration_ms'],
]);
export type ComponentTimingCapture = {
  source: 'PER_WEB_POD' | 'LOAD_BALANCED_ENDPOINT';
  instances: Array<{ id: string; name: string; metrics: Record<string, number> }>;
  errors: string[];
};
function componentMetrics(metrics: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(metrics).filter(([key]) =>
      Array.from(COMPONENT_METRICS.values()).some(metric => key.startsWith(`${metric}_`))
    )
  );
}
/** Capture each replica directly: a load-balanced scrape cannot give valid deltas. */
export async function captureAutomationTimings(options: {
  namespace?: string;
  baseUrl: string;
  metricsToken?: string;
}): Promise<ComponentTimingCapture> {
  if (!options.namespace)
    return {
      source: 'LOAD_BALANCED_ENDPOINT',
      instances: [
        {
          id: 'endpoint',
          name: 'endpoint',
          metrics: componentMetrics(
            await scrapePrometheusEndpoint(options.baseUrl, options.metricsToken)
          ),
        },
      ],
      errors: [],
    };
  const result: ComponentTimingCapture = { source: 'PER_WEB_POD', instances: [], errors: [] };
  try {
    const { stdout } = await exec(
      'kubectl',
      [
        'get',
        'pods',
        '-n',
        options.namespace,
        '-l',
        'app.kubernetes.io/instance=automation,app.kubernetes.io/component=web',
        '-o',
        'json',
      ],
      { timeout: 10000 }
    );
    const pods = JSON.parse(stdout) as {
      items: Array<{
        metadata: { name: string; uid: string };
        status: {
          phase: string;
          containerStatuses?: Array<{ ready: boolean; containerID?: string }>;
        };
      }>;
    };
    const ready = pods.items.filter(
      pod =>
        pod.status.phase === 'Running' &&
        pod.status.containerStatuses?.every(container => container.ready)
    );
    if (!ready.length) result.errors.push('No ready Web replicas for component metrics');
    const captures = await Promise.all(
      ready.map(async pod => {
        try {
          // Read the application token inside the pod; never copy it into CLI args or artifacts.
          const script = `fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/metrics',{headers:{Authorization:'Bearer '+process.env.PROMETHEUS_SCRAPE_TOKEN},signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok)throw new Error('Metrics unavailable');process.stdout.write(await r.text())}).catch(()=>process.exit(1))`;
          const { stdout: raw } = await exec(
            'kubectl',
            ['exec', '-n', options.namespace!, pod.metadata.name, '--', 'node', '-e', script],
            { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }
          );
          return {
            id: `${pod.metadata.uid}:${pod.status.containerStatuses?.map(container => container.containerID ?? '').join(',')}`,
            name: pod.metadata.name,
            metrics: componentMetrics(parsePrometheusText(raw)),
          };
        } catch {
          result.errors.push(`${pod.metadata.name}: component scrape failed`);
          return null;
        }
      })
    );
    result.instances = captures.filter(
      (capture): capture is NonNullable<typeof capture> => capture !== null
    );
  } catch {
    result.errors.push('Could not enumerate Web replicas');
  }
  return result;
}
function total(metrics: Record<string, number>, name: string) {
  return Object.entries(metrics)
    .filter(([key]) => key === name || key.startsWith(`${name}{`))
    .reduce((sum, [, value]) => sum + value, 0);
}
export function summarizeAutomationTimings(
  before: ComponentTimingCapture,
  after: ComponentTimingCapture
) {
  const previous = new Map(before.instances.map(instance => [instance.id, instance]));
  const current = new Set(after.instances.map(instance => instance.id));
  const lostInstances = before.instances
    .filter(instance => !current.has(instance.id))
    .map(instance => instance.id);
  const counterResets: string[] = [];
  const components = Object.fromEntries(
    Array.from(COMPONENT_METRICS, ([component, metric]) => {
      let count = 0,
        sumMs = 0;
      for (const instance of after.instances) {
        const old = previous.get(instance.id)?.metrics ?? {};
        const endCount = total(instance.metrics, `${metric}_count`),
          startCount = total(old, `${metric}_count`);
        const endSum = total(instance.metrics, `${metric}_sum`),
          startSum = total(old, `${metric}_sum`);
        const reset = endCount < startCount || endSum < startSum;
        if (reset) counterResets.push(`${instance.id}:${component}`);
        count += reset ? endCount : endCount - startCount;
        sumMs += reset ? endSum : endSum - startSum;
      }
      return [component, { count, sumMs, meanMs: count ? sumMs / count : null }];
    })
  );
  return {
    complete:
      before.source === 'PER_WEB_POD' &&
      after.source === 'PER_WEB_POD' &&
      before.instances.length > 0 &&
      after.instances.length > 0 &&
      !lostInstances.length &&
      !counterResets.length &&
      !before.errors.length &&
      !after.errors.length,
    lostInstances,
    counterResets,
    components,
    // Raw cumulative buckets are retained; means from surviving pods are partial
    // when a recovery drill loses a process. Never call partial coverage complete.
    before,
    after,
  };
}
