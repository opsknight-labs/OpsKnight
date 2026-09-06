#!/usr/bin/env node

/**
 * Integration Webhook Simulator (CommonJS version)
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
    },

    azure: {
        schemaId: 'azureMonitorCommonAlertSchema',
        data: {
            essentials: {
                alertId: '/subscriptions/test/alerts/' + Date.now(),
                alertRule: 'Test-High-Memory-Alert',
                severity: 'Sev1',
                monitorCondition: 'Fired',
                firedDateTime: new Date().toISOString(),
                description: 'Memory usage exceeded threshold',
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
        aggregation_key: 'datadog-test-' + Date.now(),
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
            html_url: 'https://github.com/org/test-repo/actions/runs/' + Date.now(),
        },
    },

    grafana: {
        title: 'Test Grafana Alert',
        message: 'High memory usage detected',
        state: 'alerting',
        ruleId: Date.now(),
        ruleName: 'Memory Usage Alert',
    },

    prometheus: {
        version: '4',
        groupKey: 'group-' + Date.now(),
        status: 'firing',
        receiver: 'opsknight',
        groupLabels: { alertname: 'HighCPU' },
        commonLabels: { severity: 'critical' },
        commonAnnotations: { summary: 'High CPU usage' },
        externalURL: 'https://alertmanager.example.com',
        alerts: [
            {
                status: 'firing',
                labels: { alertname: 'HighCPU', severity: 'critical' },
                annotations: { summary: 'CPU usage > 90%' },
                startsAt: new Date().toISOString(),
                generatorURL: 'https://prometheus.example.com/graph',
                fingerprint: 'fp-' + Date.now(),
            },
        ],
    },

    newrelic: {
        event_type: 'INCIDENT_OPEN',
        incident: {
            id: 'nr-' + Date.now(),
            title: 'High Response Time',
            state: 'open',
            severity: 'critical',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
    },

    opsgenie: {
        action: 'Create',
        alert: {
            alertId: 'og-' + Date.now(),
            message: 'Database connection pool exhausted',
            status: 'open',
            acknowledged: false,
            isSeen: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            priority: 'P1',
        },
    },

    pagerduty: {
        event: {
            event_type: 'incident.triggered',
            incident: {
                id: 'pd-' + Date.now(),
                incident_number: Math.floor(Math.random() * 10000),
                title: 'Production Database Down',
                status: 'triggered',
                urgency: 'high',
                created_at: new Date().toISOString(),
            },
        },
    },

    sentry: {
        action: 'created',
        issue: {
            id: 'sentry-' + Date.now(),
            shortId: 'TEST-123',
            title: 'TypeError: Cannot read property of null',
            culprit: 'src/components/Dashboard.tsx',
            level: 'error',
            status: 'unresolved',
            permalink: 'https://sentry.io/test/issues/123',
        },
    },

    webhook: {
        summary: 'Custom Alert: Service Health Check Failed',
        severity: 'critical',
        status: 'firing',
        id: 'custom-' + Date.now(),
        source: 'custom-monitor',
    },
};

async function testIntegration(type, integrationId, integrationKey) {
    const payload = SAMPLE_PAYLOADS[type];
    const url = BASE_URL + '/api/integrations/' + type + '?integrationId=' + integrationId;

    console.log('\n📤 Testing ' + type.toUpperCase() + '...');

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + integrationKey,
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (response.ok) {
            console.log('   ✅ SUCCESS (' + response.status + ')');
            return { type, success: true, status: response.status };
        } else {
            console.log('   ❌ FAILED (' + response.status + '): ' + (data.error || data.message || JSON.stringify(data)));
            return { type, success: false, status: response.status, error: data };
        }
    } catch (error) {
        console.log('   ❌ ERROR: ' + error.message);
        return { type, success: false, error: error.message };
    }
}

async function main() {
    console.log('🔧 Integration Webhook Simulator\n');

    const integrationId = process.argv[2];
    const integrationKey = process.argv[3];
    const specificType = process.argv[4];

    if (!integrationId || !integrationKey) {
        console.log('Usage: node scripts/test-integrations.cjs <integrationId> <integrationKey> [type]');
        console.log('\nAvailable types:', Object.keys(SAMPLE_PAYLOADS).join(', '));
        process.exit(1);
    }

    console.log('Base URL: ' + BASE_URL);
    console.log('Integration ID: ' + integrationId);
    console.log('Testing: ' + (specificType || 'ALL integrations'));

    const results = [];

    if (specificType) {
        if (!(specificType in SAMPLE_PAYLOADS)) {
            console.error('Unknown type: ' + specificType);
            process.exit(1);
        }
        results.push(await testIntegration(specificType, integrationId, integrationKey));
    } else {
        for (const type of Object.keys(SAMPLE_PAYLOADS)) {
            results.push(await testIntegration(type, integrationId, integrationKey));
        }
    }

    // Summary
    console.log('\n\n📊 Summary');
    console.log('==========');
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log('✅ Passed: ' + passed);
    console.log('❌ Failed: ' + failed);

    results.forEach(r => {
        console.log('  ' + (r.success ? '✅' : '❌') + ' ' + r.type);
    });

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
