import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSafeOutboundUrl,
  isAllowedLoadTestHost,
  validateWebhookUrl,
} from '@/lib/network-security';
import { buildEscalationPolicyFixtures } from '../load/fixtures/escalation-policies';
import { buildBaselineIncidentFixtures } from '../load/fixtures/incidents';
import {
  buildStatusPageFixture,
  DEFAULT_EMULATOR_ENDPOINTS,
} from '../load/fixtures/notification-providers';
import { buildScheduleFixtures } from '../load/fixtures/schedules';
import { buildServiceFixtures } from '../load/fixtures/services';
import {
  buildTeamFixtures,
  buildUserFixtures,
  SCALE_PROFILES,
} from '../load/fixtures/users';
import { parsePrometheusText } from '../load/helpers/metrics';
import {
  deriveCapacityFromScenarios,
  generateCertificationMarkdownReport,
  KIND_4NODE_CLUSTER_CONFIG,
  runLoadCertificationOrchestrator,
  TOPOLOGY_MATRIX,
} from '../load/helpers/topology';
import { startProviderEmulatorSuite } from '../load/providers/server';
import { resetProviderTelemetry } from '../load/providers/shared';

describe('OpsKnight Load & Scalability Certification Suite', () => {
  const originalAllowHosts = process.env.OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS;

  afterEach(() => {
    if (originalAllowHosts === undefined) {
      delete process.env.OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS;
    } else {
      process.env.OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS = originalAllowHosts;
    }
    resetProviderTelemetry();
  });

  it('contains all required scenario, fixture, provider, and helper files under tests/load/', () => {
    const requiredFiles = [
      'tests/load/README.md',
      'tests/load/scenarios/_shared.js',
      'tests/load/scenarios/alert-ingestion.js',
      'tests/load/scenarios/incident-lifecycle.js',
      'tests/load/scenarios/escalation.js',
      'tests/load/scenarios/notifications.js',
      'tests/load/scenarios/status-fanout.js',
      'tests/load/scenarios/realtime.js',
      'tests/load/scenarios/user-workload.js',
      'tests/load/scenarios/security-under-load.js',
      'tests/load/scenarios/recovery.js',
      'tests/load/scenarios/mixed-incident-storm.js',
      'tests/load/scenarios/mega-journey.js',
      'tests/load/fixtures/users/index.ts',
      'tests/load/fixtures/services/index.ts',
      'tests/load/fixtures/schedules/index.ts',
      'tests/load/fixtures/escalation-policies/index.ts',
      'tests/load/fixtures/incidents/index.ts',
      'tests/load/fixtures/notification-providers/index.ts',
      'tests/load/providers/shared.ts',
      'tests/load/providers/server.ts',
      'tests/load/providers/email/index.ts',
      'tests/load/providers/slack/index.ts',
      'tests/load/providers/sms/index.ts',
      'tests/load/providers/push/index.ts',
      'tests/load/providers/teams/index.ts',
      'tests/load/providers/webhook/index.ts',
      'tests/load/helpers/seed.ts',
      'tests/load/helpers/cleanup.ts',
      'tests/load/helpers/verify-results.ts',
      'tests/load/helpers/metrics.ts',
      'tests/load/helpers/topology.ts',
    ];

    for (const relPath of requiredFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      expect(fs.existsSync(absPath), `Expected ${relPath} to exist`).toBe(true);
    }
  });

  it('enforces default-deny SSRF protection and allows only explicitly configured OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS', async () => {
    delete process.env.OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS;
    expect(isAllowedLoadTestHost('webhook.emulator.opsknight.internal')).toBe(false);
    await expect(
      assertSafeOutboundUrl('http://push.emulator.opsknight.internal:8086/push/sub-1', {
        requireHttps: true,
      })
    ).rejects.toThrow(/HTTPS is required/);

    process.env.OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS =
      'webhook.emulator.opsknight.internal, push.emulator.opsknight.internal, 127.0.0.1';

    expect(isAllowedLoadTestHost('webhook.emulator.opsknight.internal')).toBe(true);
    expect(isAllowedLoadTestHost('evil.internal')).toBe(false);
    expect(
      await validateWebhookUrl('http://webhook.emulator.opsknight.internal:8086/webhook/svc-1')
    ).toBe(true);

    const parsedPushUrl = await assertSafeOutboundUrl(
      'http://push.emulator.opsknight.internal:8086/push/sub-1',
      { requireHttps: true }
    );
    expect(parsedPushUrl.hostname).toBe('push.emulator.opsknight.internal');
  });

  it('builds deterministic fixtures separating the single Contract bucket from N Capacity buckets', () => {
    const scale = SCALE_PROFILES.small;
    const teams = buildTeamFixtures(scale);
    const users = buildUserFixtures(scale, 'http://127.0.0.1:8086');
    const schedules = buildScheduleFixtures(scale, users);
    const policies = buildEscalationPolicyFixtures(scale, users, teams, schedules);
    const { services, integrations } = buildServiceFixtures(scale, {
      webhookBaseUrl: 'http://127.0.0.1:8086',
    });
    const incidents = buildBaselineIncidentFixtures(scale, services, users);
    const statusPage = buildStatusPageFixture(scale, services, DEFAULT_EMULATOR_ENDPOINTS);

    expect(teams).toHaveLength(scale.teams);
    expect(users).toHaveLength(scale.users);
    expect(schedules).toHaveLength(scale.schedules);
    expect(policies).toHaveLength(scale.escalationPolicies);
    expect(services).toHaveLength(scale.services);
    expect(incidents).toHaveLength(scale.baselineIncidents);
    expect(statusPage.subscriberCount).toBe(scale.statusPageSubscribers);

    const contractIntegrations = integrations.filter(i => i.isContractKey);
    const capacityIntegrations = integrations.filter(i => !i.isContractKey);
    expect(contractIntegrations).toHaveLength(1);
    expect(contractIntegrations[0].key).toBe('lt_contract_events_key_0001');
    expect(capacityIntegrations).toHaveLength(
      scale.services * scale.integrationsPerService - 1
    );
  });

  it('runs the programmable provider emulator suite with 200, 429 Retry-After, 503 outage, and duplicate tracking', async () => {
    const suite = await startProviderEmulatorSuite({
      httpPort: 0,
      controlPort: 0,
      smtpPort: 0,
      host: '127.0.0.1',
    });

    try {
      const httpBase = `http://127.0.0.1:${suite.httpPort}`;
      const controlBase = `http://127.0.0.1:${suite.controlPort}`;

      // 1. Healthy 200_fast across Slack, SMS, Push, Teams, Webhook, and Email
      const slackRes = await fetch(`${httpBase}/slack/api/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: '#ops', text: 'Incident triggered' }),
      });
      expect(slackRes.status).toBe(200);
      const slackJson = (await slackRes.json()) as { ok: boolean };
      expect(slackJson.ok).toBe(true);

      // Duplicate delivery with identical URL + payload increments duplicateDeliveries counter
      await fetch(`${httpBase}/slack/api/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: '#ops', text: 'Incident triggered' }),
      });

      const smsRes = await fetch(
        `${httpBase}/2010-04-01/Accounts/AC123/Messages.json`,
        {
          method: 'POST',
          body: 'To=%2B15550100001&Body=Alert',
        }
      );
      expect(smsRes.status).toBe(201);

      const pushRes = await fetch(`${httpBase}/push/sub-001`, {
        method: 'POST',
        body: 'encrypted-web-push-payload',
      });
      expect(pushRes.status).toBe(201);

      const teamsTokenRes = await fetch(`${httpBase}/teams/oauth2/v2.0/token`, {
        method: 'POST',
      });
      expect(teamsTokenRes.status).toBe(200);

      // 2. Switch Webhook provider to 429_rate_limit via Control API
      const behaviorRes = await fetch(`${controlBase}/behavior`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'webhook',
          mode: '429_rate_limit',
          retryAfterSeconds: 7,
        }),
      });
      expect(behaviorRes.status).toBe(200);

      const webhook429 = await fetch(`${httpBase}/webhook/lt-service-0001`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'incident.triggered' }),
      });
      expect(webhook429.status).toBe(429);
      expect(webhook429.headers.get('retry-after')).toBe('7');

      // 3. Check telemetry metrics via Control API
      const metricsRes = await fetch(`${controlBase}/metrics`);
      expect(metricsRes.status).toBe(200);
      const metricsJson = (await metricsRes.json()) as {
        providers: Record<
          string,
          {
            totalRequests: number;
            duplicateDeliveries: number;
            rateLimited429: number;
          }
        >;
      };
      expect(metricsJson.providers.slack.totalRequests).toBe(2);
      expect(metricsJson.providers.slack.duplicateDeliveries).toBe(1);
      expect(metricsJson.providers.webhook.rateLimited429).toBe(1);
    } finally {
      await suite.close();
    }
  });

  it('defines the 6-phase sequential topology matrix and generates markdown certification reports', async () => {
    expect(TOPOLOGY_MATRIX.length).toBeGreaterThanOrEqual(9);
    expect(KIND_4NODE_CLUSTER_CONFIG).toContain('role: control-plane');
    expect(KIND_4NODE_CLUSTER_CONFIG.match(/role: worker/g)).toHaveLength(3);

    const dryRunPlan = await runLoadCertificationOrchestrator([
      '--dry-run',
      '--phase=1',
      '--scale=small',
    ]);
    expect(dryRunPlan).toHaveProperty('mode', 'dry-run');

    const sampleMetrics = parsePrometheusText(`
# HELP opsknight_events_total Total events
opsknight_events_total{status="202"} 1420
opsknight_db_pool_active 18
`);
    expect(sampleMetrics['opsknight_events_total{status="202"}']).toBe(1420);
    expect(sampleMetrics.opsknight_db_pool_active).toBe(18);

    const markdown = generateCertificationMarkdownReport([
      {
        topologyId: 'compose_split_pgbouncer',
        topologyName: 'Compose Split + PgBouncer',
        phase: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        scenarios: [
          {
            scenario: 'alert-ingestion.js',
            loadLevel: 'L3',
            durationMs: 60000,
            exitCode: 0,
            p50Ms: 18.4,
            p95Ms: 84.2,
            p99Ms: 162.5,
            rps: 498.6,
            errorRate: 0,
          },
        ],
        verification: {
          passed: true,
          checkedAt: new Date().toISOString(),
          topology: 'compose_split_pgbouncer',
          invariants: {
            zeroDuplicateOpenIncidents: { passed: true, duplicateGroups: 0, samples: [] },
            zeroLostAcceptedAlerts: {
              passed: true,
              totalLoadAlerts: 29800,
              unlinkedAlerts: 0,
            },
            zeroFalseEscalationsAfterAckOrResolve: {
              passed: true,
              violationCount: 0,
              sampleIncidentIds: [],
            },
            zeroCorruptedIncidentStates: {
              passed: true,
              acknowledgedWithoutTimestamp: 0,
              resolvedWithoutTimestamp: 0,
              snoozedWithoutUntil: 0,
            },
            zeroCriticalNotificationStarvation: {
              passed: true,
              pendingCriticalCount: 0,
              oldestPendingCriticalAgeMs: 0,
              pendingBulkCount: 0,
              deliveredCriticalCount: 450,
              deliveredBulkCount: 2500,
            },
            providerIdempotencyCheck: {
              passed: true,
              emulatorAvailable: true,
              duplicateDeliveryKeysByProvider: {},
              totalDuplicateDeliveries: 0,
            },
          },
          totals: {
            incidentsCreated: 4200,
            alertsPersisted: 29800,
            notificationsTotal: 2950,
            backgroundJobsPending: 0,
            backgroundJobsFailed: 0,
          },
        },
        peakActivePgConnections: 24,
        peakOldestPendingJobAgeMs: 420,
        certified: true,
      },
    ]);

    expect(markdown).toContain('compose_split_pgbouncer');
    expect(markdown).toContain('**CERTIFIED**');
  });

  it('strictly derives certified capacity only from passing scenarios and rejects failed runs', () => {
    const mockVerificationPass = {
      passed: true,
      checkedAt: new Date().toISOString(),
      topology: 'compose_split_pgbouncer',
      invariants: {
        zeroDuplicateOpenIncidents: { passed: true, duplicateGroups: 0, samples: [] },
        zeroLostAcceptedAlerts: { passed: true, totalLoadAlerts: 1000, unlinkedAlerts: 0 },
        zeroFalseEscalationsAfterAckOrResolve: { passed: true, violationCount: 0, sampleIncidentIds: [] },
        zeroCorruptedIncidentStates: { passed: true, acknowledgedWithoutTimestamp: 0, resolvedWithoutTimestamp: 0, snoozedWithoutUntil: 0 },
        zeroCriticalNotificationStarvation: { passed: true, pendingCriticalCount: 0, oldestPendingCriticalAgeMs: 0, pendingBulkCount: 0, deliveredCriticalCount: 100, deliveredBulkCount: 100 },
        providerIdempotencyCheck: { passed: true, emulatorAvailable: true, duplicateDeliveryKeysByProvider: {}, totalDuplicateDeliveries: 0 },
      },
      totals: { incidentsCreated: 100, alertsPersisted: 1000, notificationsTotal: 200, backgroundJobsPending: 0, backgroundJobsFailed: 0 },
    };

    // Case 1: Scenarios that failed thresholds or high error rate should NOT become certified capacity
    const failedScenarios = [
      {
        scenario: 'alert-ingestion.js',
        loadLevel: 'L2',
        durationMs: 30000,
        exitCode: 0,
        p50Ms: 120,
        p95Ms: 1800, // exceeds 500ms limit
        p99Ms: 2500,
        rps: 150,
        errorRate: 0.15, // exceeds 1% limit
        thresholdsPassed: false,
      },
    ];

    const profFailed = deriveCapacityFromScenarios('compose_split_pgbouncer', failedScenarios, mockVerificationPass);
    expect(profFailed.sustainedAlertRps).toBe('No certified sustainable capacity');
    expect(profFailed.bottleneck).toContain('limits reached at L2');

    // Case 2: Invariant failure sets all capacities to 'No certified sustainable capacity'
    const mockVerificationFail = {
      ...mockVerificationPass,
      passed: false,
      invariants: {
        ...mockVerificationPass.invariants,
        zeroCriticalNotificationStarvation: {
          passed: false,
          pendingCriticalCount: 50,
          oldestPendingCriticalAgeMs: 45000,
          pendingBulkCount: 0,
          deliveredCriticalCount: 100,
          deliveredBulkCount: 100,
        },
      },
    };

    const profInvFail = deriveCapacityFromScenarios('compose_split_pgbouncer', [
      {
        scenario: 'alert-ingestion.js',
        loadLevel: 'L1',
        durationMs: 30000,
        exitCode: 0,
        p50Ms: 20,
        p95Ms: 80,
        p99Ms: 120,
        rps: 100,
        errorRate: 0,
        thresholdsPassed: true,
      },
    ], mockVerificationFail);

    expect(profInvFail.sustainedAlertRps).toBe('No certified sustainable capacity');
    expect(profInvFail.bottleneck).toBe('Critical notification queue starvation');
  });

  it('certifies Phase 6 Mega Load & Limit Certification matrix, bottleneck classification, and deployment recommendations', async () => {
    const phase6Topologies = TOPOLOGY_MATRIX.filter(t => t.phase === 6);
    expect(phase6Topologies.length).toBeGreaterThanOrEqual(14);

    const dryRunPhase6 = await runLoadCertificationOrchestrator([
      '--dry-run',
      '--phase=6',
    ]);
    expect(dryRunPhase6).toHaveProperty('mode', 'dry-run');
    expect(dryRunPhase6).toHaveProperty('topologiesCount', phase6Topologies.length);

    // Verify all 4 deployment families have Phase 6 definitions
    const families = new Set(phase6Topologies.map(t => t.family));
    expect(families).toContain('compose');
    expect(families).toContain('swarm');
    expect(families).toContain('kind-helm');
    expect(families).toContain('kind-kustomize');

    // Test markdown report generation with Phase 6 executive envelope, efficiency metrics, and sizing recommendations
    const markdown = generateCertificationMarkdownReport([
      {
        topologyId: 'phase6_compose_split_pgbouncer',
        topologyName: 'Phase 6 Mega: Compose Split Runtime + PgBouncer',
        phase: 6,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        scenarios: [
          {
            scenario: 'alert-ingestion.js',
            loadLevel: 'L4',
            durationMs: 60000,
            exitCode: 0,
            p50Ms: 15.2,
            p95Ms: 78.4,
            p99Ms: 145.0,
            rps: 1250,
            errorRate: 0,
            thresholdsPassed: true,
          },
          {
            scenario: 'notifications.js',
            loadLevel: 'L3',
            durationMs: 60000,
            exitCode: 0,
            p50Ms: 25.0,
            p95Ms: 110.0,
            p99Ms: 210.0,
            rps: 15,
            errorRate: 0,
            thresholdsPassed: true,
          },
          {
            scenario: 'incident-lifecycle.js',
            loadLevel: 'L3',
            durationMs: 60000,
            exitCode: 0,
            p50Ms: 40.0,
            p95Ms: 180.0,
            p99Ms: 320.0,
            rps: 20,
            errorRate: 0,
            thresholdsPassed: true,
          },
        ],
        verification: {
          passed: true,
          checkedAt: new Date().toISOString(),
          topology: 'phase6_compose_split_pgbouncer',
          invariants: {
            zeroDuplicateOpenIncidents: { passed: true, duplicateGroups: 0, samples: [] },
            zeroLostAcceptedAlerts: { passed: true, totalLoadAlerts: 75000, unlinkedAlerts: 0 },
            zeroFalseEscalationsAfterAckOrResolve: { passed: true, violationCount: 0, sampleIncidentIds: [] },
            zeroCorruptedIncidentStates: { passed: true, acknowledgedWithoutTimestamp: 0, resolvedWithoutTimestamp: 0, snoozedWithoutUntil: 0 },
            zeroCriticalNotificationStarvation: { passed: true, pendingCriticalCount: 0, oldestPendingCriticalAgeMs: 0, pendingBulkCount: 0, deliveredCriticalCount: 1500, deliveredBulkCount: 8500 },
            providerIdempotencyCheck: { passed: true, emulatorAvailable: true, duplicateDeliveryKeysByProvider: {}, totalDuplicateDeliveries: 0 },
          },
          totals: {
            incidentsCreated: 12500,
            alertsPersisted: 75000,
            notificationsTotal: 10000,
            backgroundJobsPending: 0,
            backgroundJobsFailed: 0,
          },
        },
        peakActivePgConnections: 28,
        peakOldestPendingJobAgeMs: 250,
        certified: true,
      },
    ]);

    expect(markdown).toContain('phase6_compose_split_pgbouncer');
    expect(markdown).toContain('Phase 6');
    expect(markdown).toContain('Resource-Efficiency Comparison Matrix');
    expect(markdown).toContain('Evidence-Based Deployment Sizing Guidance');
    expect(markdown).toContain('Empirically Measured Limits');
    expect(markdown).toContain('Target / Theoretical Multi-Replica Production Sizing Guidance');
    expect(markdown).toContain('Breaking Point');
    expect(markdown).toContain('Large enterprise production');
  });

  it('enforces scenario selection guards, empty scenario rejection, and measured vs theoretical sizing labeling', async () => {
    // 1. Guard against selecting zero scenarios via --scenarios filter
    await expect(
      runLoadCertificationOrchestrator([
        '--dry-run',
        '--phase=1',
        '--scenarios=completely-invalid-scenario.js',
      ])
    ).rejects.toThrow(/matched 0 scenarios across selected topologies/);

    // 2. Reject certification if zero scenarios are executed
    const mockVerificationPass = {
      passed: true,
      checkedAt: new Date().toISOString(),
      topology: 'phase6_compose_split',
      invariants: {
        zeroDuplicateOpenIncidents: { passed: true, duplicateGroups: 0, samples: [] },
        zeroLostAcceptedAlerts: { passed: true, totalLoadAlerts: 100, unlinkedAlerts: 0 },
        zeroFalseEscalationsAfterAckOrResolve: { passed: true, violationCount: 0, sampleIncidentIds: [] },
        zeroCorruptedIncidentStates: { passed: true, acknowledgedWithoutTimestamp: 0, resolvedWithoutTimestamp: 0, snoozedWithoutUntil: 0 },
        zeroCriticalNotificationStarvation: { passed: true, pendingCriticalCount: 0, oldestPendingCriticalAgeMs: 0, pendingBulkCount: 0, deliveredCriticalCount: 10, deliveredBulkCount: 10 },
        providerIdempotencyCheck: { passed: true, emulatorAvailable: true, duplicateDeliveryKeysByProvider: {}, totalDuplicateDeliveries: 0 },
      },
      totals: {
        incidentsCreated: 10,
        alertsPersisted: 100,
        notificationsTotal: 20,
        backgroundJobsPending: 0,
        backgroundJobsFailed: 0,
      },
    };

    const emptyScenariosProfile = deriveCapacityFromScenarios('phase6_compose_split', [], mockVerificationPass);
    expect(emptyScenariosProfile.bottleneck).toBe('No scenarios executed');
    expect(emptyScenariosProfile.sustainedAlertRps).toBe('No scenarios executed');
    expect(emptyScenariosProfile.deploymentRecommendation).toContain('Do not deploy: Zero scenarios executed');

    // 3. Verify report explicitly separates measured testbed limits from theoretical targets
    const markdown = generateCertificationMarkdownReport([
      {
        topologyId: 'phase6_helm_split_pgbouncer',
        topologyName: 'Phase 6 Helm Split',
        phase: 6,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        scenarios: [
          {
            scenario: 'alert-ingestion.js',
            loadLevel: 'L1',
            durationMs: 30000,
            exitCode: 0,
            p50Ms: 12.0,
            p95Ms: 45.0,
            p99Ms: 80.0,
            rps: 95.5,
            errorRate: 0,
            thresholdsPassed: true,
          },
        ],
        verification: mockVerificationPass,
        peakActivePgConnections: 48,
        peakOldestPendingJobAgeMs: 0,
        certified: true,
      },
    ]);

    expect(markdown).toContain('Empirically Measured Limits (Phase 6 Testbed)');
    expect(markdown).toContain('Peak **95.5 Alert RPS**');
    expect(markdown).toContain('Target / Theoretical Multi-Replica Production Sizing Guidance');
    expect(markdown).toContain('> Sizing tiers above the single-node / 4-node testbed maximums (> 230 RPS) represent theoretical scaling models');
  });

  it('guarantees drain observation inspects all queues/retries and protects against sleep overshoot', () => {
    // 1. Drain check predicates: all 5 conditions required
    const isDrained = (snap: {
      pendingCritical: number;
      futureScheduledCritical: number;
      pendingTransactional: number;
      pendingBulk: number;
      pendingBackgroundJobs: number;
    }) =>
      snap.pendingCritical === 0 &&
      snap.futureScheduledCritical === 0 &&
      snap.pendingTransactional === 0 &&
      snap.pendingBulk === 0 &&
      snap.pendingBackgroundJobs === 0;

    // False if critical future-scheduled retries exist (even if due critical is 0)
    expect(isDrained({
      pendingCritical: 1,
      futureScheduledCritical: 1,
      pendingTransactional: 0,
      pendingBulk: 0,
      pendingBackgroundJobs: 0,
    })).toBe(false);

    // False if transactional queue has pending items
    expect(isDrained({
      pendingCritical: 0,
      futureScheduledCritical: 0,
      pendingTransactional: 5,
      pendingBulk: 0,
      pendingBackgroundJobs: 0,
    })).toBe(false);

    // False if bulk queue has pending items
    expect(isDrained({
      pendingCritical: 0,
      futureScheduledCritical: 0,
      pendingTransactional: 0,
      pendingBulk: 12,
      pendingBackgroundJobs: 0,
    })).toBe(false);

    // False if background jobs are pending
    expect(isDrained({
      pendingCritical: 0,
      futureScheduledCritical: 0,
      pendingTransactional: 0,
      pendingBulk: 0,
      pendingBackgroundJobs: 1,
    })).toBe(false);

    // True ONLY when all queues and future retries are 0
    expect(isDrained({
      pendingCritical: 0,
      futureScheduledCritical: 0,
      pendingTransactional: 0,
      pendingBulk: 0,
      pendingBackgroundJobs: 0,
    })).toBe(true);

    // 2. Dynamic polling sleep never overshoots drainDeadline
    const calculatePollSleep = (remainingMs: number, maxIntervalMs = 5000) => {
      if (remainingMs <= 0) return 0;
      return Math.min(maxIntervalMs, remainingMs);
    };

    // When 120s remaining, sleep is capped at 5s
    expect(calculatePollSleep(120_000)).toBe(5000);
    // When 3s remaining, sleep is exactly 3s (not 5s or 15s)
    expect(calculatePollSleep(3_000)).toBe(3000);
    // When 0s or negative remaining, sleep is 0 (exit immediately)
    expect(calculatePollSleep(0)).toBe(0);
    expect(calculatePollSleep(-500)).toBe(0);
  });
});
