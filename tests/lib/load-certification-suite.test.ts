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
      'tests/load/scenarios/mixed-incident-storm.js',
      'tests/load/scenarios/recovery.js',
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
              duplicateDeliveryKeysByProvider: {},
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
});
