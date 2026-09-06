#!/usr/bin/env node

/**
 * Integration Webhook Simulator
 *
 * Tests all integrations locally by sending mock webhooks.
 *
 * Usage:
 *   npx ts-node scripts/test-integrations.ts
 *
 * Prerequisites:
 *   1. Have the dev server running (npm run dev)
 *   2. Have at least one integration created in your database
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Sample payloads for each integration type
const SAMPLE_PAYLOADS = {
  cloudwatch: {
    AlarmName: 'Test-High-CPU-Alarm',
    AlarmDescription: 'CPU utilization exceeded 80%',
    NewStateValue: 'ALARM',
    NewStateReason: 'Threshold Crossed: 1 datapoint (85.5) was greater than the threshold (80.0)',
    StateChangeTime: new Date().toISOString(),
    Region: 'us-east-1',
    Trigger: {
      MetricName: 'CPUUtilization',
      Namespace: 'AWS/EC2',
      Statistic: 'Average',
      Threshold: 80.0,
    },
  },

  azure: {
    schemaId: 'azureMonitorCommonAlertSchema',
    data: {
      essentials: {
        alertId: `/subscriptions/test/alerts/${Date.now()}`,
        alertRule: 'Test-High-Memory-Alert',
        severity: 'Sev1',
        signalType: 'Metric',
        monitorCondition: 'Fired',
        monitoringService: 'Platform',
        firedDateTime: new Date().toISOString(),
        description: 'Memory usage exceeded threshold',
      },
      alertContext: {
        condition: {
          allOf: [{ metricName: 'PercentMemory', threshold: 90 }],
        },
      },
    },
  },

  datadog: {
    event_type: 'alert',
    title: 'Test Datadog Alert',
    text: 'High error rate detected on production API',
    alert_type: 'error',
    date_happened: Math.floor(Date.now() / 1000),
    tags: ['env:production', 'service:api'],
    host: 'prod-api-01',
    aggregation_key: `datadog-test-${Date.now()}`,
    source_type_name: 'MONITOR',
    alert: {
      id: `alert-${Date.now()}`,
      title: 'High Error Rate',
      message: 'Error rate > 5% for 5 minutes',
      status: 'Triggered',
      severity: 'error',
    },
  },

  github: {
    action: 'completed',
    repository: {
      name: 'test-repo',
      full_name: 'org/test-repo',
      html_url: 'https://github.com/org/test-repo',
    },
    workflow_run: {
      id: Date.now(),
      name: 'CI Pipeline',
      status: 'completed',
      conclusion: 'failure',
      html_url: `https://github.com/org/test-repo/actions/runs/${Date.now()}`,
    },
  },

  grafana: {
    title: 'Test Grafana Alert',
    message: 'High memory usage detected',
    state: 'alerting',
    ruleId: Date.now(),
    ruleName: 'Memory Usage Alert',
    ruleUrl: 'https://grafana.example.com/alerting/test',
    evalMatches: [{ metric: 'memory_usage_percent', value: 92.5, tags: { host: 'web-01' } }],
    tags: { severity: 'critical' },
  },

  prometheus: {
    version: '4',
    groupKey: `group-${Date.now()}`,
    status: 'firing',
    receiver: 'opsknight',
    groupLabels: { alertname: 'HighCPU' },
    commonLabels: { severity: 'critical', job: 'node-exporter' },
    commonAnnotations: { summary: 'High CPU usage on production nodes' },
    externalURL: 'https://alertmanager.example.com',
    alerts: [
      {
        status: 'firing',
        labels: { alertname: 'HighCPU', instance: 'web-01:9090', severity: 'critical' },
        annotations: { summary: 'CPU usage > 90%', description: 'Very high CPU on web-01' },
        startsAt: new Date().toISOString(),
        generatorURL: 'https://prometheus.example.com/graph?g0.expr=cpu_usage',
        fingerprint: `fp-${Date.now()}`,
      },
    ],
  },

  newrelic: {
    account_id: 12345,
    account_name: 'Test Account',
    event_type: 'INCIDENT_OPEN',
    incident: {
      id: `nr-${Date.now()}`,
      title: 'High Response Time',
      state: 'open',
      severity: 'critical',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      condition_name: 'Response Time > 2s',
      policy_name: 'Production Alerts',
    },
  },

  opsgenie: {
    action: 'Create',
    alert: {
      alertId: `og-${Date.now()}`,
      alias: `alias-${Date.now()}`,
      message: 'Database connection pool exhausted',
      description: 'No available connections in pool for 5 minutes',
      status: 'open',
      acknowledged: false,
      isSeen: false,
      tags: ['database', 'production'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'Test Script',
      priority: 'P1',
    },
  },

  pagerduty: {
    event: {
      event_type: 'incident.triggered',
      incident: {
        id: `pd-${Date.now()}`,
        incident_number: Math.floor(Math.random() * 10000),
        title: 'Production Database Down',
        description: 'Primary database is not responding to health checks',
        status: 'triggered',
        urgency: 'high',
        created_at: new Date().toISOString(),
        service: {
          id: 'PSVC123',
          name: 'Production API',
        },
      },
    },
  },

  sentry: {
    action: 'created',
    issue: {
      id: `sentry-${Date.now()}`,
      shortId: 'TEST-123',
      title: 'TypeError: Cannot read property of null',
      culprit: 'src/components/Dashboard.tsx',
      level: 'error',
      status: 'unresolved',
      metadata: {
        type: 'TypeError',
        value: "Cannot read property 'map' of null",
      },
      permalink: 'https://sentry.io/test/issues/123',
    },
    project: {
      name: 'frontend',
      slug: 'frontend',
    },
  },

  webhook: {
    summary: 'Custom Alert: Service Health Check Failed',
    title: 'Health Check Failure',
    message: 'The /health endpoint returned 503',
    severity: 'critical',
    status: 'firing',
    id: `custom-${Date.now()}`,
    source: 'custom-monitor',
    timestamp: new Date().toISOString(),
    custom_field: 'This is a test custom webhook',
  },
};

async function testIntegration(
  type: keyof typeof SAMPLE_PAYLOADS,
  integrationId: string,
  integrationKey: string
) {
  const payload = SAMPLE_PAYLOADS[type];
  const url = `${BASE_URL}/api/integrations/${type}?integrationId=${integrationId}`;

  console.log(`\n📤 Testing ${type.toUpperCase()} integration...`);
  console.log(`   URL: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${integrationKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`   ✅ SUCCESS (${response.status})`);
      console.log(`   Result: ${JSON.stringify(data.result || data, null, 2).slice(0, 200)}...`);
      return { type, success: true, status: response.status };
    } else {
      console.log(`   ❌ FAILED (${response.status})`);
      console.log(`   Error: ${JSON.stringify(data)}`);
      return { type, success: false, status: response.status, error: data };
    }
  } catch (error) {
    console.log(`   ❌ ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return { type, success: false, error: String(error) };
  }
}

async function main() {
  console.log('🔧 Integration Webhook Simulator');
  console.log('================================\n');

  const integrationId = process.argv[2];
  const integrationKey = process.argv[3];
  const specificType = process.argv[4] as keyof typeof SAMPLE_PAYLOADS | undefined;

  if (!integrationId || !integrationKey) {
    console.log(
      'Usage: npx ts-node scripts/test-integrations.ts <integrationId> <integrationKey> [type]'
    );
    console.log('\nExample:');
    console.log('  npx ts-node scripts/test-integrations.ts cm123abc mySecretKey');
    console.log('  npx ts-node scripts/test-integrations.ts cm123abc mySecretKey datadog');
    console.log('\nAvailable types:', Object.keys(SAMPLE_PAYLOADS).join(', '));
    console.log('\nTo get your integrationId and key:');
    console.log('  1. Go to Services → Select a Service → Integrations');
    console.log('  2. Create or view an integration');
    console.log('  3. Copy the integration ID from the URL and the key from the UI');
    process.exit(1);
  }

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Integration ID: ${integrationId}`);
  console.log(`Testing: ${specificType || 'ALL integrations'}\n`);

  const results = [];

  if (specificType) {
    if (!(specificType in SAMPLE_PAYLOADS)) {
      console.error(`Unknown integration type: ${specificType}`);
      console.log('Available types:', Object.keys(SAMPLE_PAYLOADS).join(', '));
      process.exit(1);
    }
    results.push(await testIntegration(specificType, integrationId, integrationKey));
  } else {
    for (const type of Object.keys(SAMPLE_PAYLOADS) as Array<keyof typeof SAMPLE_PAYLOADS>) {
      results.push(await testIntegration(type, integrationId, integrationKey));
    }
  }

  // Summary
  console.log('\n\n📊 Summary');
  console.log('==========');
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  results.forEach(r => {
    const icon = r.success ? '✅' : '❌';
    console.log(`  ${icon} ${r.type}`);
  });

  if (failed > 0) {
    console.log('\n⚠️  Some integrations failed. Check:');
    console.log('   - Is the dev server running? (npm run dev)');
    console.log('   - Is the integration ID correct?');
    console.log('   - Is the integration key correct?');
    console.log('   - Does the integration type match the endpoint?');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
