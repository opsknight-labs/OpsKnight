import { describe, it, expect } from 'vitest';
import { INTEGRATION_TYPES, IntegrationType } from '@/components/service/integration-types';

describe('Service Integration Types UI Registry', () => {
  it('should include all 28 integration types', () => {
    const values = INTEGRATION_TYPES.map(t => t.value);

    // Check core and new integrations
    expect(values).toContain('EVENTS_API_V2');
    expect(values).toContain('CLOUDWATCH');
    expect(values).toContain('AZURE');
    expect(values).toContain('GOOGLE_CLOUD_MONITORING');
    expect(values).toContain('DATADOG');
    expect(values).toContain('GRAFANA');
    expect(values).toContain('PROMETHEUS');
    expect(values).toContain('NEWRELIC');
    expect(values).toContain('SENTRY');
    expect(values).toContain('GITHUB');
    expect(values).toContain('GITLAB');
    expect(values).toContain('VERCEL');
    expect(values).toContain('ZABBIX');
    expect(values).toContain('PAGERDUTY');
    expect(values).toContain('NAGIOS');
    expect(values).toContain('ICINGA');
    expect(values).toContain('BITBUCKET');
    expect(values).toContain('UPTIMEROBOT');
    expect(values).toContain('PINGDOM');
    expect(values).toContain('BETTER_UPTIME');
    expect(values).toContain('UPTIME_KUMA');
    expect(values).toContain('SPLUNK_ONCALL');
    expect(values).toContain('SPLUNK_OBSERVABILITY');
    expect(values).toContain('DYNATRACE');
    expect(values).toContain('APPDYNAMICS');
    expect(values).toContain('ELASTIC');
    expect(values).toContain('HONEYCOMB');
    expect(values).toContain('WEBHOOK');
  });

  it('should have valid metadata and category for every integration', () => {
    for (const item of INTEGRATION_TYPES) {
      expect(item.label).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.icon).toBeDefined();
      expect(item.iconBg).toBeTruthy();
    }
  });
});
