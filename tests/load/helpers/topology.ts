import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ScaleProfileName } from '../fixtures/users';
import { startProviderEmulatorSuite } from '../providers/server';
import { runLoadCleanup } from './cleanup';
import { startContinuousTelemetryCollector, TelemetrySample } from './metrics';
import { runLoadSeed } from './seed';
import { CorrectnessInvariantReport, verifyLoadCertificationResults } from './verify-results';

const execFileAsync = promisify(execFile);

export type CertificationPhaseId = 1 | 2 | 3 | 4 | 5 | 6;

export interface TopologyDefinition {
  id: string;
  name: string;
  phase: CertificationPhaseId;
  family: 'compose' | 'swarm' | 'kind-helm' | 'kind-kustomize';
  description: string;
  baseUrl: string;
  k8sNamespace?: string;
  deployCommands: string[];
  recoveryDrills: Array<{
    name: string;
    role: string;
    faultCommand: string;
  }>;
  teardownCommands: string[];
  scenarios: string[];
  defaultLoadLevels: string[];
}

export const TOPOLOGY_MATRIX: TopologyDefinition[] = [
  // Phase 1: Compose Baseline & Split Matrix
  {
    id: 'compose_integrated_bundled_db',
    name: 'Compose: Integrated Runtime + Bundled PostgreSQL',
    phase: 1,
    family: 'compose',
    description: 'Single-container web+worker runtime against bundled PostgreSQL 15',
    baseUrl: 'http://127.0.0.1:3100',
    deployCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f tests/load/deploy/compose/load.override.yml up -d --wait',
    ],
    recoveryDrills: [
      {
        name: 'restart_integrated_app',
        role: 'opsknight-app',
        faultCommand: 'docker compose -f deploy/compose/docker-compose.yml restart opsknight-app',
      },
    ],
    teardownCommands: [
      'docker compose -f deploy/compose/docker-compose.yml down -v --remove-orphans',
    ],
    scenarios: [
      'alert-ingestion.js',
      'incident-lifecycle.js',
      'escalation.js',
      'notifications.js',
      'status-fanout.js',
      'realtime.js',
    ],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3', 'L4'],
  },
  {
    id: 'compose_split_bundled_db',
    name: 'Compose: Split Runtime + Bundled PostgreSQL',
    phase: 1,
    family: 'compose',
    description:
      'Dedicated web, scheduler, general-worker, critical-worker, bulk-worker, status-projector',
    baseUrl: 'http://127.0.0.1:3100',
    deployCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml -f tests/load/deploy/compose/load.override.yml up -d --wait',
    ],
    recoveryDrills: [
      {
        name: 'kill_critical_worker',
        role: 'critical-worker',
        faultCommand:
          'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml restart opsknight-critical-worker',
      },
      {
        name: 'kill_scheduler',
        role: 'scheduler',
        faultCommand:
          'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml restart opsknight-scheduler',
      },
    ],
    teardownCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml down -v --remove-orphans',
    ],
    scenarios: [
      'alert-ingestion.js',
      'incident-lifecycle.js',
      'escalation.js',
      'notifications.js',
      'status-fanout.js',
      'realtime.js',
      'recovery.js',
    ],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'],
  },
  {
    id: 'compose_split_pgbouncer',
    name: 'Compose: Split Runtime + PgBouncer + Bundled PostgreSQL',
    phase: 1,
    family: 'compose',
    description:
      'Full split runtime with transaction-pooled PgBouncer for web/workers and session-pooled PgBouncer for scheduler',
    baseUrl: 'http://127.0.0.1:3100',
    deployCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml -f deploy/compose/docker-compose.pgbouncer.yml -f tests/load/deploy/compose/load.override.yml up -d --wait',
    ],
    recoveryDrills: [
      {
        name: 'restart_pgbouncer',
        role: 'pgbouncer',
        faultCommand:
          'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml -f deploy/compose/docker-compose.pgbouncer.yml restart opsknight-pgbouncer',
      },
      {
        name: 'kill_bulk_worker',
        role: 'bulk-worker',
        faultCommand:
          'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml -f deploy/compose/docker-compose.pgbouncer.yml restart opsknight-bulk-worker',
      },
    ],
    teardownCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml -f deploy/compose/docker-compose.pgbouncer.yml down -v --remove-orphans',
    ],
    scenarios: [
      'alert-ingestion.js',
      'incident-lifecycle.js',
      'escalation.js',
      'notifications.js',
      'status-fanout.js',
      'realtime.js',
      'recovery.js',
      'mixed-incident-storm.js',
    ],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'],
  },

  // Phase 2: Compose External DB & CA Variants
  {
    id: 'compose_integrated_external_db',
    name: 'Compose: Integrated Runtime + External PostgreSQL',
    phase: 2,
    family: 'compose',
    description: 'Integrated runtime connected to an external PostgreSQL instance',
    baseUrl: 'http://127.0.0.1:3100',
    deployCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.external-db.yml up -d --wait',
    ],
    recoveryDrills: [],
    teardownCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.external-db.yml down -v --remove-orphans',
    ],
    scenarios: ['alert-ingestion.js', 'incident-lifecycle.js', 'notifications.js'],
    defaultLoadLevels: ['L0', 'L1', 'L2'],
  },
  {
    id: 'compose_split_pgbouncer_external_db_ca',
    name: 'Compose: Split Runtime + PgBouncer + External PostgreSQL + Custom CA',
    phase: 2,
    family: 'compose',
    description:
      'Split runtime + PgBouncer against external TLS PostgreSQL with custom CA bundle mount',
    baseUrl: 'http://127.0.0.1:3100',
    deployCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml -f deploy/compose/docker-compose.pgbouncer.yml -f deploy/compose/docker-compose.external-db.yml -f deploy/compose/docker-compose.pgbouncer-ca.yml up -d --wait',
    ],
    recoveryDrills: [],
    teardownCommands: [
      'docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.split.yml -f deploy/compose/docker-compose.pgbouncer.yml -f deploy/compose/docker-compose.external-db.yml -f deploy/compose/docker-compose.pgbouncer-ca.yml down -v --remove-orphans',
    ],
    scenarios: ['alert-ingestion.js', 'incident-lifecycle.js', 'escalation.js', 'notifications.js'],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3'],
  },

  // Phase 3: Docker Swarm Matrix
  {
    id: 'swarm_single_node_split',
    name: 'Docker Swarm: Single-Node Split Stack + PgBouncer',
    phase: 3,
    family: 'swarm',
    description: 'Docker Swarm stack deployment with split worker roles and PgBouncer',
    baseUrl: 'http://127.0.0.1:3100',
    deployCommands: [
      'docker swarm init 2>/dev/null || true',
      'SWARM_STACK_NAME=opsknight-load SWARM_RUNTIME_MODE=split ENABLE_PGBOUNCER=true SWARM_EXTRA_STACK_FILE=tests/load/deploy/swarm/load.override.yml SWARM_REPLICAS_WEB=1 SWARM_REPLICAS_SCHEDULER=1 SWARM_REPLICAS_GENERAL_WORKER=1 SWARM_REPLICAS_CRITICAL_WORKER=1 SWARM_REPLICAS_BULK_WORKER=1 SWARM_REPLICAS_STATUS_PROJECTOR=1 SWARM_REPLICAS_PGBOUNCER=1 ALLOW_INSECURE_SECRETS=true bash deploy/swarm/scripts/deploy.sh',
      'docker service update --publish-add published=5432,target=5432 opsknight-load_opsknight-db 2>/dev/null || true',
    ],
    recoveryDrills: [
      {
        name: 'swarm_kill_critical_worker',
        role: 'critical-worker',
        faultCommand: 'docker service update --force opsknight-load_opsknight-critical-worker',
      },
      {
        name: 'swarm_kill_scheduler',
        role: 'scheduler',
        faultCommand: 'docker service update --force opsknight-load_opsknight-scheduler',
      },
      {
        name: 'swarm_kill_pgbouncer',
        role: 'pgbouncer',
        faultCommand: 'docker service update --force opsknight-load_opsknight-pgbouncer',
      },
    ],
    teardownCommands: ['docker stack rm opsknight-load'],
    scenarios: [
      'alert-ingestion.js',
      'incident-lifecycle.js',
      'escalation.js',
      'notifications.js',
      'status-fanout.js',
      'realtime.js',
      'recovery.js',
    ],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L8'],
  },
  {
    id: 'swarm_ha_split',
    name: 'Docker Swarm: High-Availability (HA) Multi-Replica Split Stack',
    phase: 3,
    family: 'swarm',
    description:
      'Swarm HA overlay with 2x replicas across web, general-worker, critical-worker, bulk-worker, status-projector, and pgbouncer',
    baseUrl: 'http://127.0.0.1:3100',
    deployCommands: [
      'docker swarm init 2>/dev/null || true',
      'SWARM_STACK_NAME=opsknight-load SWARM_RUNTIME_MODE=split ENABLE_PGBOUNCER=true SWARM_EXTRA_STACK_FILE=tests/load/deploy/swarm/load.override.yml SWARM_REPLICAS_WEB=2 SWARM_REPLICAS_SCHEDULER=2 SWARM_REPLICAS_GENERAL_WORKER=2 SWARM_REPLICAS_CRITICAL_WORKER=2 SWARM_REPLICAS_BULK_WORKER=2 SWARM_REPLICAS_STATUS_PROJECTOR=2 SWARM_REPLICAS_PGBOUNCER=2 ALLOW_INSECURE_SECRETS=true bash deploy/swarm/scripts/deploy.sh',
      'docker service update --publish-add published=5432,target=5432 opsknight-load_opsknight-db 2>/dev/null || true',
    ],
    recoveryDrills: [
      {
        name: 'swarm_ha_rolling_web_restart',
        role: 'web',
        faultCommand: 'docker service update --force opsknight-load_opsknight-web',
      },
      {
        name: 'swarm_ha_kill_general_worker',
        role: 'general-worker',
        faultCommand: 'docker service update --force opsknight-load_opsknight-general-worker',
      },
      {
        name: 'swarm_ha_kill_status_projector',
        role: 'status-projector',
        faultCommand: 'docker service update --force opsknight-load_opsknight-status-projector',
      },
    ],
    teardownCommands: ['docker stack rm opsknight-load'],
    scenarios: [
      'alert-ingestion.js',
      'incident-lifecycle.js',
      'escalation.js',
      'notifications.js',
      'status-fanout.js',
      'realtime.js',
      'recovery.js',
      'mixed-incident-storm.js',
    ],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'],
  },

  // Phase 4: Kind Multi-Node Kubernetes (1 control-plane + 3 workers)
  {
    id: 'kind_helm_split_pgbouncer',
    name: 'Kind Kubernetes (4-Node): Helm Split Runtime + PgBouncer + HPA/PDB',
    phase: 4,
    family: 'kind-helm',
    description:
      '1 control-plane + 3 worker Kind cluster running Helm chart in namespace helm-test with PgBouncer and split workers',
    baseUrl: 'http://127.0.0.1:3100',
    k8sNamespace: 'helm-test',
    deployCommands: [
      'kubectl create namespace helm-test --dry-run=client -o yaml | kubectl apply -f -',
      'helm upgrade --install opsknight deploy/kubernetes/helm/opsknight -n helm-test -f deploy/kubernetes/helm/opsknight/examples/values-split-runtime.yaml -f tests/load/deploy/kubernetes/helm/values-load-cert.yaml --set image.repository=opsknight-certification --set-string image.tag=local --set image.pullPolicy=Never --set pgbouncer.enabled=true --set pgbouncer.image.repository=opsknight-pgbouncer --set-string pgbouncer.image.tag=1.26.0 --set-string pgbouncer.image.digest="" --set pgbouncer.image.pullPolicy=Never --set postgresql.image.pullPolicy=Never --wait --timeout 5m',
      'pkill -f "kubectl -n helm-test port-forward" 2>/dev/null || true',
      'nohup bash -c "while true; do kubectl -n helm-test port-forward service/opsknight 3100:80 >/dev/null 2>&1; sleep 0.5; done" >/dev/null 2>&1 &',
      'nohup bash -c "while true; do kubectl -n helm-test port-forward service/opsknight-postgresql 5432:5432 >/dev/null 2>&1; sleep 0.5; done" >/dev/null 2>&1 &',
      'sleep 5',
    ],
    recoveryDrills: [
      {
        name: 'k8s_helm_delete_critical_worker_pod',
        role: 'critical-worker',
        faultCommand:
          'kubectl delete pod -n helm-test -l opsknight-role=critical-worker --wait=false',
      },
      {
        name: 'k8s_helm_delete_scheduler_pod',
        role: 'scheduler',
        faultCommand:
          'kubectl delete pod -n helm-test -l opsknight-role=scheduler --wait=false',
      },
      {
        name: 'k8s_helm_delete_pgbouncer_pod',
        role: 'pgbouncer',
        faultCommand:
          'kubectl delete pod -n helm-test -l app.kubernetes.io/component=pgbouncer --wait=false',
      },
    ],
    teardownCommands: [
      'pkill -f "kubectl -n helm-test port-forward" 2>/dev/null || true',
      'helm uninstall opsknight -n helm-test --wait || true',
      'kubectl delete namespace helm-test --wait=false || true',
    ],
    scenarios: [
      'alert-ingestion.js',
      'incident-lifecycle.js',
      'escalation.js',
      'notifications.js',
      'status-fanout.js',
      'realtime.js',
      'recovery.js',
      'mixed-incident-storm.js',
    ],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'],
  },
  {
    id: 'kind_kustomize_split_pgbouncer',
    name: 'Kind Kubernetes (4-Node): Kustomize Split + PgBouncer Profile',
    phase: 4,
    family: 'kind-kustomize',
    description:
      '1 control-plane + 3 worker Kind cluster running Kustomize split-pgbouncer profile in namespace kustomize-test (executed after helm-test teardown)',
    baseUrl: 'http://127.0.0.1:3100',
    k8sNamespace: 'kustomize-test',
    deployCommands: [
      'kubectl create namespace kustomize-test --dry-run=client -o yaml | kubectl apply -f -',
      'kubectl kustomize tests/load/deploy/kubernetes/kustomize/load-cert-overlay | sed "s/namespace: opsknight/namespace: kustomize-test/g; s|ghcr.io/opsknight-labs/opsknight:split-runtime-image-required|opsknight-certification:local|g; s|ghcr.io/icoretech/pgbouncer-docker@[^ \\"]*|opsknight-pgbouncer:1.26.0|g; s/imagePullPolicy: Always/imagePullPolicy: Never/g" | kubectl apply -f -',
      'kubectl rollout status statefulset/opsknight-postgres -n kustomize-test --timeout=5m && kubectl rollout status deployment -n kustomize-test --timeout=5m',
      'pkill -f "kubectl -n kustomize-test port-forward" 2>/dev/null || true',
      'nohup bash -c "while true; do kubectl -n kustomize-test port-forward service/opsknight-service 3100:80 >/dev/null 2>&1; sleep 0.5; done" >/dev/null 2>&1 &',
      'nohup bash -c "while true; do kubectl -n kustomize-test port-forward service/opsknight-postgres-service 5432:5432 >/dev/null 2>&1; sleep 0.5; done" >/dev/null 2>&1 &',
      'sleep 5',
    ],
    recoveryDrills: [
      {
        name: 'k8s_kustomize_delete_critical_worker_pod',
        role: 'critical-worker',
        faultCommand:
          'kubectl delete pod -n kustomize-test -l opsknight-role=critical-worker --wait=false',
      },
      {
        name: 'k8s_kustomize_delete_bulk_worker_pod',
        role: 'bulk-worker',
        faultCommand:
          'kubectl delete pod -n kustomize-test -l opsknight-role=bulk-worker --wait=false',
      },
    ],
    teardownCommands: [
      'pkill -f "kubectl -n kustomize-test port-forward" 2>/dev/null || true',
      'kubectl delete namespace kustomize-test --wait=true --ignore-not-found=true || true',
    ],
    scenarios: [
      'alert-ingestion.js',
      'incident-lifecycle.js',
      'escalation.js',
      'notifications.js',
      'status-fanout.js',
      'realtime.js',
      'recovery.js',
      'mixed-incident-storm.js',
    ],
    defaultLoadLevels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'],
  },
];

export const KIND_4NODE_CLUSTER_CONFIG = `kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
  - role: worker
`;

export interface ScenarioExecutionRecord {
  scenario: string;
  loadLevel: string;
  durationMs: number;
  exitCode: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rps: number;
  errorRate: number;
  thresholdsPassed?: boolean;
}

export interface TopologyCertificationResult {
  topologyId: string;
  topologyName: string;
  phase: CertificationPhaseId;
  startedAt: string;
  completedAt: string;
  scenarios: ScenarioExecutionRecord[];
  verification: CorrectnessInvariantReport;
  peakActivePgConnections: number;
  peakOldestPendingJobAgeMs: number;
  certified: boolean;
}

function getAugmentedEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const home = process.env.HOME || '';
  const extraPaths = [
    home ? `${home}/.local/bin` : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH || '',
  ]
    .filter(Boolean)
    .join(':');
  const baseEnv = { ...process.env };
  delete baseEnv.DATABASE_URL;
  delete baseEnv.DIRECT_DATABASE_URL;
  delete baseEnv.WEB_DATABASE_URL;
  return {
    ...baseEnv,
    POSTGRES_USER: 'opsknight',
    POSTGRES_PASSWORD: 'devpassword',
    POSTGRES_DB: 'opsknight_db',
    POSTGRES_PORT: '5432',
    APP_PORT: '3100',
    NEXTAUTH_SECRET: 'load_cert_nextauth_secret_32_bytes_minimum_value_0123456789',
    ENCRYPTION_KEY: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    OPSKNIGHT_IMAGE: 'opsknight-certification:local',
    OPSKNIGHT_PULL_POLICY: 'never',
    PGBOUNCER_IMAGE: 'opsknight-pgbouncer:1.26.0',
    OPSKNIGHT_PGBOUNCER_IMAGE: 'opsknight-pgbouncer:1.26.0',
    AUTO_LABEL_DATABASE_NODE: 'true',
    SWARM_RESOLVE_IMAGE_NEVER: 'true',
    OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS:
      'host.docker.internal,webhook.emulator.opsknight.internal,push.emulator.opsknight.internal,127.0.0.1,localhost',
    ...extra,
    PATH: extraPaths,
  };
}

async function runShellCommand(cmd: string, envOverrides?: Record<string, string>): Promise<void> {
  await execFileAsync('bash', ['-lc', cmd], {
    cwd: process.cwd(),
    env: getAugmentedEnv(envOverrides),
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function waitForHttpHealth(baseUrl: string, timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) return true;
    } catch {
      // Wait for container readiness
    }
    await new Promise(r => setTimeout(r, 2_000));
  }
  return false;
}

async function runK6Scenario(options: {
  scenarioFile: string;
  loadLevel: string;
  durationProfile: string;
  baseUrl: string;
  manifestPath: string;
  summaryJsonPath: string;
  extraEnv?: Record<string, string>;
}): Promise<ScenarioExecutionRecord> {
  const scenarioPath = path.resolve(process.cwd(), 'tests/load/scenarios', options.scenarioFile);
  const started = Date.now();
  let exitCode = 0;

  try {
    await execFileAsync(
      'k6',
      [
        'run',
        '--summary-export',
        options.summaryJsonPath,
        '--summary-trend-stats',
        'avg,min,med,max,p(90),p(95),p(99)',
        '-e',
        `BASE_URL=${options.baseUrl}`,
        '-e',
        `LOAD_LEVEL=${options.loadLevel}`,
        '-e',
        `LOAD_DURATION_PROFILE=${options.durationProfile}`,
        '-e',
        `LOAD_SEED_MANIFEST=${options.manifestPath}`,
        ...Object.entries(options.extraEnv ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        scenarioPath,
      ],
      {
        cwd: process.cwd(),
        env: getAugmentedEnv(),
        maxBuffer: 20 * 1024 * 1024,
      }
    );
  } catch (err) {
    exitCode = typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : 1;
    const stderr = (err as { stderr?: string }).stderr;
    if (stderr) {
      console.warn(`    [k6 stderr] ${stderr.trim().split('\n').slice(-10).join('\n    ')}`);
    }
  }

  const durationMs = Date.now() - started;
  let p50Ms = 0;
  let p95Ms = 0;
  let p99Ms = 0;
  let rps = 0;
  let errorRate = 0;

  try {
    const raw = await fs.readFile(options.summaryJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      metrics?: Record<
        string,
        {
          med?: number;
          'p(95)'?: number;
          'p(99)'?: number;
          rate?: number;
          value?: number;
          values?: {
            med?: number;
            'p(95)'?: number;
            'p(99)'?: number;
            rate?: number;
            value?: number;
          };
        }
      >;
    };
    const httpDur = parsed.metrics?.http_req_duration?.values ?? parsed.metrics?.http_req_duration;
    if (httpDur) {
      p50Ms = Number((httpDur.med ?? 0).toFixed(2));
      p95Ms = Number((httpDur['p(95)'] ?? 0).toFixed(2));
      p99Ms = Number((httpDur['p(99)'] ?? 0).toFixed(2));
    }
    const httpReqs = parsed.metrics?.http_reqs?.values ?? parsed.metrics?.http_reqs;
    if (httpReqs?.rate) {
      rps = Number(httpReqs.rate.toFixed(2));
    }
    const httpFailed = parsed.metrics?.http_req_failed?.values ?? parsed.metrics?.http_req_failed;
    if (typeof httpFailed?.value === 'number') {
      errorRate = Number(httpFailed.value.toFixed(4));
    } else if (typeof httpFailed?.rate === 'number') {
      errorRate = Number(httpFailed.rate.toFixed(4));
    }
  } catch {
    // Summary file may not exist if k6 binary is not installed or exited early
  }

  const thresholdsPassed = exitCode === 0 && errorRate <= 0.01;

  return {
    scenario: options.scenarioFile,
    loadLevel: options.loadLevel,
    durationMs,
    exitCode,
    p50Ms,
    p95Ms,
    p99Ms,
    rps,
    errorRate,
    thresholdsPassed,
  };
}

export interface DerivedCapacityProfile {
  sustainedAlertRps: string;
  burstAlertRps: string;
  notificationRate: string;
  escalationRate: string;
  concurrentUsers: string;
  sseStreams: string;
  statusFanout: string;
  bottleneck: string;
}

export function deriveCapacityFromScenarios(
  topologyId: string,
  records: ScenarioExecutionRecord[],
  verification: CorrectnessInvariantReport
): DerivedCapacityProfile {
  if (records.length === 0) {
    return {
      sustainedAlertRps: 'Measured on run',
      burstAlertRps: 'Measured on run',
      notificationRate: 'Measured on run',
      escalationRate: 'Measured on run',
      concurrentUsers: 'Measured on run',
      sseStreams: 'Measured on run',
      statusFanout: 'Measured on run',
      bottleneck: 'Pending execution',
    };
  }

  // 1. Bottleneck Attribution
  let bottleneck = 'Within headroom limits';
  if (!verification.passed) {
    const inv = verification.invariants;
    if (!inv.zeroCriticalNotificationStarvation.passed) {
      bottleneck = 'Critical notification queue starvation';
    } else if (!inv.zeroDuplicateOpenIncidents.passed) {
      bottleneck = 'Dedup concurrency conflict on incident creation';
    } else if (!inv.providerIdempotencyCheck.passed) {
      bottleneck = 'Provider webhook duplicate deliveries';
    } else if (!inv.zeroLostAcceptedAlerts.passed) {
      bottleneck = 'Unlinked accepted alerts buffer leak';
    } else if (!inv.zeroFalseEscalationsAfterAckOrResolve.passed) {
      bottleneck = 'False escalation after ACK or resolve';
    } else if (!inv.zeroCorruptedIncidentStates.passed) {
      bottleneck = 'Corrupted incident lifecycle state';
    } else {
      bottleneck = 'Correctness invariant violation under load';
    }

    return {
      sustainedAlertRps: 'No certified sustainable capacity',
      burstAlertRps: 'No certified sustainable capacity',
      notificationRate: 'No certified sustainable capacity',
      escalationRate: 'No certified sustainable capacity',
      concurrentUsers: 'No certified sustainable capacity',
      sseStreams: 'No certified sustainable capacity',
      statusFanout: 'No certified sustainable capacity',
      bottleneck,
    };
  }

  const broken = records.find(
    r => r.exitCode !== 0 || r.errorRate > 0.01 || r.thresholdsPassed === false
  );
  if (broken) {
    if (topologyId.includes('integrated')) {
      bottleneck = `Shared web+worker CPU loop saturation at ${broken.loadLevel}`;
    } else if (topologyId.includes('bundled_db') && !topologyId.includes('pgbouncer')) {
      bottleneck = `PostgreSQL client connection saturation without pooler at ${broken.loadLevel}`;
    } else if (topologyId.includes('swarm')) {
      bottleneck = `Swarm overlay network / ingress routing latency at ${broken.loadLevel}`;
    } else {
      bottleneck = `Worker pod resource / pool limits reached at ${broken.loadLevel}`;
    }
  }

  const isScenarioPassing = (r: ScenarioExecutionRecord, maxErrorRate = 0.01, maxP95Ms?: number) =>
    r.exitCode === 0 &&
    r.thresholdsPassed !== false &&
    r.errorRate <= maxErrorRate &&
    (maxP95Ms === undefined || r.p95Ms <= maxP95Ms);

  // 2. Alert Ingestion (Strict thresholds: errorRate <= 1%, p95 <= 500ms)
  const alertRecords = records.filter(r => r.scenario.includes('alert-ingestion'));
  const validAlertRecords = alertRecords.filter(r => isScenarioPassing(r, 0.01, 500));
  const maxSustainedAlertRps =
    validAlertRecords.length > 0 ? Math.max(...validAlertRecords.map(r => r.rps)) : 0;

  const validBurstRecords = alertRecords.filter(r => isScenarioPassing(r, 0.05, 1500));
  const maxBurstAlertRps =
    validBurstRecords.length > 0 ? Math.max(...validBurstRecords.map(r => r.rps)) : 0;

  // 3. Notifications (Strict thresholds: errorRate <= 1%)
  const notifRecords = records.filter(r => r.scenario.includes('notifications'));
  const validNotifRecords = notifRecords.filter(r => isScenarioPassing(r, 0.01, 2000));
  const maxNotifRps =
    validNotifRecords.length > 0 ? Math.max(...validNotifRecords.map(r => r.rps)) : 0;

  // 4. Escalations (Strict thresholds: errorRate <= 1%)
  const escRecords = records.filter(r => r.scenario.includes('escalation'));
  const validEscRecords = escRecords.filter(r => isScenarioPassing(r, 0.01, 2000));
  const maxEscRps =
    validEscRecords.length > 0 ? Math.max(...validEscRecords.map(r => r.rps)) : 0;

  // 5. Concurrent users (VUs) (Strict thresholds: p95 <= 1000ms, errorRate <= 1%)
  const levelToVUs: Record<string, number> = { L0: 5, L1: 25, L2: 100, L3: 300, L4: 1000 };
  const lifecycleRecords = records.filter(r => r.scenario.includes('incident-lifecycle'));
  const validLifecycleRecords = lifecycleRecords.filter(r => isScenarioPassing(r, 0.01, 1000));
  const maxVUs =
    validLifecycleRecords.length > 0
      ? Math.max(...validLifecycleRecords.map(r => levelToVUs[r.loadLevel] || 25))
      : 0;

  // 6. SSE Realtime Streams
  const realtimeRecords = records.filter(r => r.scenario.includes('realtime'));
  const validRealtimeRecords = realtimeRecords.filter(r => isScenarioPassing(r, 0.01));
  const maxSseVUs =
    validRealtimeRecords.length > 0
      ? Math.max(...validRealtimeRecords.map(r => levelToVUs[r.loadLevel] || 10))
      : 0;

  // 7. Status Fanout
  const fanoutRecords = records.filter(r => r.scenario.includes('status-fanout'));
  const validFanoutRecords = fanoutRecords.filter(r => isScenarioPassing(r, 0.01));
  const maxFanoutRps =
    validFanoutRecords.length > 0 ? Math.max(...validFanoutRecords.map(r => r.rps)) : 0;

  return {
    sustainedAlertRps:
      maxSustainedAlertRps > 0
        ? `${Math.round(maxSustainedAlertRps)} RPS`
        : alertRecords.length > 0
          ? 'No certified sustainable capacity'
          : 'Measured on run',
    burstAlertRps:
      maxBurstAlertRps > 0
        ? `${Math.round(maxBurstAlertRps)} RPS`
        : alertRecords.length > 0
          ? 'No certified sustainable capacity'
          : 'Measured on run',
    notificationRate:
      maxNotifRps > 0
        ? `~${Math.round(maxNotifRps * 60)} / min`
        : notifRecords.length > 0
          ? 'No certified sustainable capacity'
          : 'Measured on run',
    escalationRate:
      maxEscRps > 0
        ? `${Math.round(maxEscRps)} / sec`
        : escRecords.length > 0
          ? 'No certified sustainable capacity'
          : 'Measured on run',
    concurrentUsers:
      maxVUs > 0
        ? `${maxVUs} VUs`
        : lifecycleRecords.length > 0
          ? 'No certified sustainable capacity'
          : 'Measured on run',
    sseStreams:
      maxSseVUs > 0
        ? `~${maxSseVUs} streams`
        : realtimeRecords.length > 0
          ? 'No certified sustainable capacity'
          : 'Measured on run',
    statusFanout:
      maxFanoutRps > 0
        ? `~${Math.round(maxFanoutRps * 60)} / min`
        : fanoutRecords.length > 0
          ? 'No certified sustainable capacity'
          : 'Measured on run',
    bottleneck,
  };
}

export function generateCertificationMarkdownReport(
  results: TopologyCertificationResult[]
): string {
  const lines: string[] = [
    '# OpsKnight Load & Scalability Certification Report',
    '',
    `Generated: \`${new Date().toISOString()}\``,
    '',
    '## 1. Executive Capacity & Sizing Envelope',
    '',
    '| Deployment Topology | Sustainable Alert Ingestion | Burst Alert Ingestion | Notification Dispatch | Escalation Processing | Concurrent Users | SSE Realtime Streams | Status Page Fanout | Primary Bottleneck at Saturation | Status |',
    '| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :---: |',
  ];

  for (const r of results) {
    const prof = deriveCapacityFromScenarios(r.topologyId, r.scenarios, r.verification);
    const certBadge = r.certified ? '**CERTIFIED**' : '**FAILED**';
    lines.push(
      `| \`${r.topologyId}\` | ${prof.sustainedAlertRps} | ${prof.burstAlertRps} | ${prof.notificationRate} | ${prof.escalationRate} | ${prof.concurrentUsers} | ${prof.sseStreams} | ${prof.statusFanout} | ${prof.bottleneck} | ${certBadge} |`
    );
  }

  lines.push('', '## 2. Benchmark Measured Telemetry Summary', '');
  lines.push(
    '| Phase | Topology | Scenarios | Peak RPS | p95 (ms) | p99 (ms) | Peak PG Conns | Max Queue Age (ms) | Invariants | Status |'
  );
  lines.push('| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');

  for (const r of results) {
    const peakRps = Math.max(0, ...r.scenarios.map(s => s.rps));
    const maxP95 = Math.max(0, ...r.scenarios.map(s => s.p95Ms));
    const maxP99 = Math.max(0, ...r.scenarios.map(s => s.p99Ms));
    const invStatus = r.verification.passed ? 'PASS' : 'FAIL';
    const certBadge = r.certified ? 'CERTIFIED' : 'FAILED';
    lines.push(
      `| Phase ${r.phase} | \`${r.topologyId}\` | ${r.scenarios.length} | ${peakRps.toFixed(1)} | ${maxP95.toFixed(1)} | ${maxP99.toFixed(1)} | ${r.peakActivePgConnections} | ${r.peakOldestPendingJobAgeMs} | ${invStatus} | **${certBadge}** |`
    );
  }

  lines.push('', '## 3. Standardized Resource Profiles', '');
  lines.push('- **Host Specifications**: 10-core CPU, 16 GB RAM, Darwin arm64 / Linux x86_64, Docker Engine 28.x, Kind v0.31.0.');
  lines.push('- **Docker Compose**:');
  lines.push('  - Integrated: 1 container (web+worker), max DB pool = 40, PostgreSQL max_connections = 100.');
  lines.push('  - Split: web (pool=10), critical-worker (pool=15), general-worker (pool=15), bulk-worker (pool=10), status-projector (pool=5).');
  lines.push('  - PgBouncer: Transaction mode pooling, max 200 client connections -> 30 server connections.');
  lines.push('- **Docker Swarm HA**: 2x Web, 2x Critical Worker, 2x General Worker, 2x Bulk Worker, 2x Status Projector, 2x PgBouncer.');
  lines.push('- **Kind Kubernetes (4-Node)**: 1 Control Plane + 3 Worker Nodes, PodDisruptionBudgets (`minAvailable: 1`), isolated worker CPU/RAM quotas.');

  lines.push('', '## 4. Correctness Invariant Certification', '');
  lines.push(
    '| Topology | Zero Duplicate Open Incidents | Zero Lost Accepted Alerts | Zero False Escalations | Zero Corrupted States | Zero Critical Starvation |'
  );
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: |');

  for (const r of results) {
    const inv = r.verification.invariants;
    lines.push(
      `| \`${r.topologyId}\` | ${inv.zeroDuplicateOpenIncidents.passed ? 'PASS (0)' : `FAIL (${inv.zeroDuplicateOpenIncidents.duplicateGroups})`} | ${inv.zeroLostAcceptedAlerts.passed ? `PASS (${inv.zeroLostAcceptedAlerts.totalLoadAlerts})` : `FAIL (${inv.zeroLostAcceptedAlerts.unlinkedAlerts})`} | ${inv.zeroFalseEscalationsAfterAckOrResolve.passed ? 'PASS (0)' : `FAIL (${inv.zeroFalseEscalationsAfterAckOrResolve.violationCount})`} | ${inv.zeroCorruptedIncidentStates.passed ? 'PASS (0)' : 'FAIL'} | ${inv.zeroCriticalNotificationStarvation.passed ? `PASS (${inv.zeroCriticalNotificationStarvation.oldestPendingCriticalAgeMs}ms)` : 'FAIL'} |`
    );
  }

  return lines.join('\n');
}

function parseOrchestratorArgs(argv: string[]) {
  let dryRun = false;
  let phaseFilter: number | null = null;
  let topologyFilter: string | null = null;
  let scale: ScaleProfileName = 'medium';
  let durationProfile = 'fast';
  let levelsOverride: string[] | null = null;
  let skipDeploy = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--plan') dryRun = true;
    else if (arg === '--skip-deploy') skipDeploy = true;
    else if (arg.startsWith('--phase=')) phaseFilter = Number(arg.split('=')[1]);
    else if (arg === '--phase' && argv[i + 1]) phaseFilter = Number(argv[++i]);
    else if (arg.startsWith('--topology=')) topologyFilter = arg.split('=')[1];
    else if (arg === '--topology' && argv[i + 1]) topologyFilter = argv[++i];
    else if (arg.startsWith('--scale=')) scale = arg.split('=')[1] as ScaleProfileName;
    else if (arg === '--scale' && argv[i + 1]) scale = argv[++i] as ScaleProfileName;
    else if (arg.startsWith('--duration=')) durationProfile = arg.split('=')[1];
    else if (arg === '--duration' && argv[i + 1]) durationProfile = argv[++i];
    else if (arg.startsWith('--levels=')) levelsOverride = arg.split('=')[1].split(',');
    else if (arg === '--levels' && argv[i + 1]) levelsOverride = argv[++i].split(',');
  }

  return {
    dryRun,
    phaseFilter,
    topologyFilter,
    scale,
    durationProfile,
    levelsOverride,
    skipDeploy,
  };
}

export async function runLoadCertificationOrchestrator(argv = process.argv.slice(2)) {
  const opts = parseOrchestratorArgs(argv);
  const selectedTopologies = TOPOLOGY_MATRIX.filter(t => {
    if (opts.phaseFilter !== null && t.phase !== opts.phaseFilter) return false;
    if (opts.topologyFilter && t.id !== opts.topologyFilter) return false;
    return true;
  });

  if (opts.dryRun) {
    const planSummary = {
      mode: 'dry-run',
      sequentialExecutionRule:
        'Strictly one topology at a time: deploy -> warmup -> seed -> baseline -> load -> stress -> recovery -> verify -> cleanup -> teardown',
      scaleProfile: opts.scale,
      durationProfile: opts.durationProfile,
      topologiesCount: selectedTopologies.length,
      topologies: selectedTopologies.map(t => ({
        id: t.id,
        phase: t.phase,
        family: t.family,
        levels: opts.levelsOverride ?? t.defaultLoadLevels,
        scenarios: t.scenarios,
        recoveryDrills: t.recoveryDrills.map(d => d.name),
      })),
    };
    console.log(JSON.stringify(planSummary, null, 2));
    return planSummary;
  }

  // Ensure host-side Prisma helpers (seed, metrics, verify-results, cleanup) and
  // container deployments share identical credentials and encryption keys.
  const alignedEnv = getAugmentedEnv();
  for (const [k, v] of Object.entries(alignedEnv)) {
    if (v !== undefined) process.env[k] = v;
  }
  process.env.POSTGRES_USER = 'opsknight';
  process.env.POSTGRES_PASSWORD = 'devpassword';
  process.env.POSTGRES_DB = 'opsknight_db';
  process.env.POSTGRES_PORT = '5432';
  process.env.DATABASE_URL =
    'postgresql://opsknight:devpassword@127.0.0.1:5432/opsknight_db?sslmode=disable&connection_limit=15';
  process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL;
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY =
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
  }
  if (
    !process.env.NEXTAUTH_SECRET ||
    process.env.NEXTAUTH_SECRET === 'change_this_to_a_random_secret_in_production'
  ) {
    process.env.NEXTAUTH_SECRET = 'load_cert_nextauth_secret_32_bytes_minimum_value_0123456789';
  }

  const emulatorSuite = await startProviderEmulatorSuite();
  const results: TopologyCertificationResult[] = [];
  const artifactsRoot = path.resolve(process.cwd(), 'artifacts/load-certification');
  await fs.mkdir(artifactsRoot, { recursive: true });

  try {
    for (const topology of selectedTopologies) {
      const startedAt = new Date().toISOString();
      const topologyDir = path.join(artifactsRoot, topology.id);
      await fs.mkdir(topologyDir, { recursive: true });
      console.log(`\n=== [Phase ${topology.phase}] Deploying ${topology.id} (${topology.name}) ===`);

      if (!opts.skipDeploy) {
        for (const cmd of topology.deployCommands) {
          console.log(`  $ ${cmd}`);
          await runShellCommand(cmd);
        }
      }

      const healthy = await waitForHttpHealth(topology.baseUrl, 90_000);
      if (!healthy) {
        throw new Error(`Topology ${topology.id} failed health check at ${topology.baseUrl}`);
      }
      console.log(`  [Health] ${topology.id} is healthy at ${topology.baseUrl}`);

      const manifestPath = path.join(topologyDir, 'seed-manifest.json');
      await runLoadSeed({
        scale: opts.scale,
        manifestPath,
        baseUrl: topology.baseUrl,
      });
      console.log(`  [Seed] Seeded scale=${opts.scale} fixtures into ${topology.id}`);

      const telemetry = await startContinuousTelemetryCollector({
        topology: topology.id,
        stage: 'execution',
        baseUrl: topology.baseUrl,
        outputDir: topologyDir,
        k8sNamespace: topology.k8sNamespace,
      });

      const scenarioRecords: ScenarioExecutionRecord[] = [];
      const levels = opts.levelsOverride ?? topology.defaultLoadLevels;

      for (const level of levels) {
        for (const scenarioFile of topology.scenarios) {
          const summaryJsonPath = path.join(
            topologyDir,
            `k6-${scenarioFile.replace(/\.js$/, '')}-${level}.json`
          );

          // If running recovery.js and topology has recovery drills, trigger all declared recovery drills
          if (scenarioFile === 'recovery.js' && topology.recoveryDrills.length > 0 && !opts.skipDeploy) {
            for (const drill of topology.recoveryDrills) {
              const drillSummaryPath = path.join(
                topologyDir,
                `k6-recovery-${drill.name}-${level}.json`
              );
              let drillTimer: NodeJS.Timeout | null = null;
              drillTimer = setTimeout(() => {
                void runShellCommand(drill.faultCommand).catch(() => undefined);
              }, 5_000);

              const drillRecord = await runK6Scenario({
                scenarioFile,
                loadLevel: level,
                durationProfile: opts.durationProfile,
                baseUrl: topology.baseUrl,
                manifestPath,
                summaryJsonPath: drillSummaryPath,
              });

              if (drillTimer) clearTimeout(drillTimer);
              drillRecord.scenario = `recovery-${drill.name}`;
              console.log(
                `  [Recovery Drill] ${drill.name} (${drill.role}) @ ${level}: exit=${drillRecord.exitCode} rps=${drillRecord.rps} p95=${drillRecord.p95Ms}ms err=${drillRecord.errorRate}`
              );
              scenarioRecords.push(drillRecord);
            }
            continue;
          }

          const record = await runK6Scenario({
            scenarioFile,
            loadLevel: level,
            durationProfile: opts.durationProfile,
            baseUrl: topology.baseUrl,
            manifestPath,
            summaryJsonPath,
          });

          console.log(
            `  [Scenario] ${scenarioFile} @ ${level}: exit=${record.exitCode} rps=${record.rps} p95=${record.p95Ms}ms p99=${record.p99Ms}ms err=${record.errorRate}`
          );
          scenarioRecords.push(record);
        }
      }

      const samples: TelemetrySample[] = await telemetry.stop();
      const verification = await verifyLoadCertificationResults({
        topology: topology.id,
        outputPath: path.join(topologyDir, 'verification-report.json'),
        waitForDrainMs: 90_000,
      });
      console.log(
        `  [Verify] ${topology.id} invariants passed=${verification.passed} incidents=${verification.totals.incidentsCreated} alerts=${verification.totals.alertsPersisted} notifications=${verification.totals.notificationsTotal}`
      );

      const peakActivePgConnections = Math.max(
        0,
        ...samples.map(s => s.postgres.activeConnections)
      );
      const peakOldestPendingJobAgeMs = Math.max(
        0,
        ...samples.map(s => s.postgres.oldestPendingJobAgeMs)
      );

      const allScenariosPassed = scenarioRecords.every(
        s => s.exitCode === 0 && s.thresholdsPassed !== false && s.errorRate <= 0.01
      );
      results.push({
        topologyId: topology.id,
        topologyName: topology.name,
        phase: topology.phase,
        startedAt,
        completedAt: new Date().toISOString(),
        scenarios: scenarioRecords,
        verification,
        peakActivePgConnections,
        peakOldestPendingJobAgeMs,
        certified: verification.passed && allScenariosPassed,
      });

      try {
        await runLoadCleanup();
      } catch (cleanupErr) {
        console.warn(`  [Cleanup] Warning during cleanup for ${topology.id}: ${(cleanupErr as Error).message}`);
      }

      if (!opts.skipDeploy) {
        for (const cmd of topology.teardownCommands) {
          await runShellCommand(cmd).catch(() => undefined);
        }
      }
      console.log(`  [Teardown] Completed teardown for ${topology.id}`);
    }

    let mergedResults = [...results];
    const summaryFile = path.join(artifactsRoot, 'certification-summary.json');
    try {
      const existingRaw = await fs.readFile(summaryFile, 'utf8');
      const existing: TopologyCertificationResult[] = JSON.parse(existingRaw);
      const newIds = new Set(results.map(r => r.topologyId));
      mergedResults = [...existing.filter(e => !newIds.has(e.topologyId)), ...results];
    } catch {
      // Direct results fallback
    }

    const reportMd = generateCertificationMarkdownReport(mergedResults);
    await fs.writeFile(path.join(artifactsRoot, 'CERTIFICATION_REPORT.md'), reportMd, 'utf8');
    const docsBenchmarksDir = path.join(process.cwd(), 'docs', 'benchmarks');
    await fs.mkdir(docsBenchmarksDir, { recursive: true });
    await fs.writeFile(path.join(docsBenchmarksDir, 'load-certification.md'), reportMd, 'utf8');
    await fs.writeFile(
      path.join(artifactsRoot, 'certification-summary.json'),
      JSON.stringify(mergedResults, null, 2),
      'utf8'
    );

    return mergedResults;
  } finally {
    await emulatorSuite.close();
  }
}

if (require.main === module) {
  runLoadCertificationOrchestrator().catch(err => {
    console.error('Load certification orchestrator failed:', err);
    process.exit(1);
  });
}
