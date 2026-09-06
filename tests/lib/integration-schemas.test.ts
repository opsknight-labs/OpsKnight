import { describe, it, expect } from 'vitest';
import {
  validatePayload,
  CloudWatchAlarmSchema,
  GitHubEventSchema,
  PrometheusAlertSchema,
  GenericWebhookSchema,
  IntegrationSchemas,
} from '@/lib/integrations/schemas';

describe('Integration Schemas', () => {
  describe('CloudWatchAlarmSchema', () => {
    it('should validate valid CloudWatch alarm', () => {
      const payload = {
        AlarmName: 'HighCPU',
        AlarmDescription: 'CPU usage exceeded 80%',
        NewStateValue: 'ALARM',
        NewStateReason: 'Threshold Crossed',
        StateChangeTime: '2024-01-15T12:00:00Z',
        Region: 'us-east-1',
      };

      const result = validatePayload(CloudWatchAlarmSchema, payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid NewStateValue', () => {
      const payload = {
        AlarmName: 'Test',
        NewStateValue: 'INVALID',
        NewStateReason: 'Test',
        StateChangeTime: '2024-01-15T12:00:00Z',
        Region: 'us-east-1',
      };

      const result = validatePayload(CloudWatchAlarmSchema, payload);
      expect(result.success).toBe(false);
    });
  });

  describe('GitHubEventSchema', () => {
    it('should validate GitHub workflow run event', () => {
      const payload = {
        action: 'completed',
        repository: {
          name: 'my-repo',
          full_name: 'org/my-repo',
          html_url: 'https://github.com/org/my-repo',
        },
        workflow_run: {
          id: 12345,
          name: 'CI',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/org/my-repo/actions/runs/12345',
        },
      };

      const result = validatePayload(GitHubEventSchema, payload);
      expect(result.success).toBe(true);
    });

    it('should validate GitLab CI event', () => {
      const payload = {
        object_kind: 'pipeline',
        project: {
          name: 'my-project',
          path_with_namespace: 'org/my-project',
          web_url: 'https://gitlab.com/org/my-project',
        },
        status: 'failed',
        ref: 'main',
        commit: {
          message: 'Fix bug',
        },
      };

      const result = validatePayload(GitHubEventSchema, payload);
      expect(result.success).toBe(true);
    });
  });

  describe('PrometheusAlertSchema', () => {
    it('should validate Alertmanager webhook', () => {
      const payload = {
        version: '4',
        groupKey: 'group1',
        status: 'firing',
        receiver: 'webhook',
        groupLabels: { alertname: 'HighMemory' },
        commonLabels: { severity: 'critical' },
        commonAnnotations: { summary: 'Memory usage high' },
        externalURL: 'https://alertmanager.example.com',
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'HighMemory', instance: 'server1' },
            annotations: { summary: 'Memory > 90%' },
            startsAt: '2024-01-15T12:00:00Z',
            generatorURL: 'https://prometheus.example.com/graph',
            fingerprint: 'abc123',
          },
        ],
      };

      const result = validatePayload(PrometheusAlertSchema, payload);
      expect(result.success).toBe(true);
    });

    it('should require at least one alert', () => {
      const payload = {
        version: '4',
        groupKey: 'group1',
        status: 'firing',
        receiver: 'webhook',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        externalURL: 'https://alertmanager.example.com',
        alerts: [],
      };

      const result = validatePayload(PrometheusAlertSchema, payload);
      expect(result.success).toBe(false);
    });
  });

  describe('GenericWebhookSchema', () => {
    it('should validate minimal webhook payload', () => {
      const payload = {
        summary: 'Alert triggered',
        status: 'firing',
      };

      const result = validatePayload(GenericWebhookSchema, payload);
      expect(result.success).toBe(true);
    });

    it('should allow additional fields (passthrough)', () => {
      const payload = {
        summary: 'Test',
        custom_field: 'custom_value',
        nested: { data: true },
      };

      const result = validatePayload(GenericWebhookSchema, payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>).custom_field).toBe('custom_value');
      }
    });
  });

  describe('IntegrationSchemas lookup', () => {
    it('should have schemas for all integration types', () => {
      const expectedTypes = [
        'CLOUDWATCH',
        'AZURE',
        'DATADOG',
        'GITHUB',
        'GRAFANA',
        'PROMETHEUS',
        'NEWRELIC',
        'SENTRY',
        'GOOGLE_CLOUD_MONITORING',
        'SPLUNK_ONCALL',
        'SPLUNK_OBSERVABILITY',
        'DYNATRACE',
        'APPDYNAMICS',
        'ELASTIC',
        'HONEYCOMB',
        'BITBUCKET',
        'UPTIMEROBOT',
        'PINGDOM',
        'BETTER_UPTIME',
        'UPTIME_KUMA',
        'WEBHOOK',
      ];

      expectedTypes.forEach(type => {
        expect(IntegrationSchemas[type as keyof typeof IntegrationSchemas]).toBeDefined();
      });
    });
  });

  describe('validatePayload helper', () => {
    it('should return success true with data on valid payload', () => {
      const result = validatePayload(GenericWebhookSchema, { summary: 'Test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.summary).toBe('Test');
      }
    });

    it('should return structured errors on invalid payload', () => {
      const result = validatePayload(PrometheusAlertSchema, { invalid: true });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toBeInstanceOf(Array);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toHaveProperty('path');
        expect(result.errors[0]).toHaveProperty('message');
      }
    });
  });
});
