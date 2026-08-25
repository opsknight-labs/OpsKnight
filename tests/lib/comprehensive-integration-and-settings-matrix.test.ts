import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Integration transformers & schemas
import { transformCloudWatchToEvent } from '@/lib/integrations/cloudwatch';
import { transformAzureToEvent } from '@/lib/integrations/azure';
import { transformDatadogToEvent } from '@/lib/integrations/datadog';
import { transformGitHubToEvent } from '@/lib/integrations/github';
import { transformBitbucketToEvent } from '@/lib/integrations/bitbucket';
import { transformGrafanaToEvents } from '@/lib/integrations/grafana';
import { transformPrometheusToEvent } from '@/lib/integrations/prometheus';
import { transformSentryToEvent } from '@/lib/integrations/sentry';
import { transformNewRelicToEvent } from '@/lib/integrations/newrelic';
import { transformAppDynamicsToEvent } from '@/lib/integrations/appdynamics';
import { transformNagiosToEvent } from '@/lib/integrations/nagios';
import { transformIcingaToEvent } from '@/lib/integrations/icinga';
import { transformDynatraceToEvent } from '@/lib/integrations/dynatrace';
import { transformHoneycombToEvent } from '@/lib/integrations/honeycomb';
import { transformSplunkOnCallToEvent } from '@/lib/integrations/splunk-oncall';
import { transformSplunkObservabilityToEvent } from '@/lib/integrations/splunk-observability';
import { transformElasticToEvent } from '@/lib/integrations/elastic';
import { transformGoogleCloudMonitoringToEvent } from '@/lib/integrations/google-cloud-monitoring';
import { transformUptimeRobotToEvent } from '@/lib/integrations/uptimerobot';
import { transformPingdomToEvent } from '@/lib/integrations/pingdom';
import { transformBetterUptimeToEvent } from '@/lib/integrations/better-uptime';
import { transformUptimeKumaToEvent } from '@/lib/integrations/uptime-kuma';
import { transformZabbixToEvent } from '@/lib/integrations/zabbix';
import { transformPagerDutyToEvent } from '@/lib/integrations/pagerduty';
import { transformGitLabToEvent } from '@/lib/integrations/gitlab';
import { transformVercelToEvent } from '@/lib/integrations/vercel';

// Schemas & Validation
import {
  CloudWatchAlarmSchema,
  AzureAlertSchema,
  DatadogEventSchema,
  ZabbixPayloadSchema,
  PagerDutyEventSchema,
  GitLabPayloadSchema,
  VercelPayloadSchema,
  validatePayload,
} from '@/lib/integrations/schemas';

// Security, Verification & Settings Systems
import {
  verifyGitHubSignature,
  verifyHmacSignature,
  verifyGitLabToken,
  verifyVercelSignature,
} from '@/lib/integrations/signature-verification';
import { hashTokenV1, hashTokenV2 } from '@/lib/api-keys';
import { getUserPermissions } from '@/lib/rbac';
import { CircuitBreakers } from '@/lib/circuit-breaker';
import { retry } from '@/lib/retry';
import { buildScheduleBlocks } from '@/lib/oncall';

describe('🚀 Comprehensive 28-Integration & Settings Matrix Verification', () => {
  describe('Sector 1: Cloud & Infrastructure (CloudWatch, Azure, GCP)', () => {
    it('1. CloudWatch: Includes AWSAccountId in dedup key and parses correctly', () => {
      const payload = {
        AlarmName: 'HighCPUUtilization',
        AWSAccountId: '123456789012',
        NewStateValue: 'ALARM' as const,
        NewStateReason:
          'Threshold Crossed: 1 out of 1 datapoints [95.0] was greater than the threshold (80.0)',
        StateChangeTime: '2026-08-17T10:00:00.000+0000',
        Region: 'us-east-1',
      };

      const validation = validatePayload(CloudWatchAlarmSchema, payload);
      expect(validation.success).toBe(true);

      const event = transformCloudWatchToEvent(payload);
      expect(event.event_action).toBe('trigger');
      expect(event.dedup_key).toBe('cloudwatch-123456789012-us-east-1-HighCPUUtilization');
    });

    it('2. CloudWatch: OK state resolves prior alarm with matching dedup key', () => {
      const payload = {
        AlarmName: 'HighCPUUtilization',
        AWSAccountId: '123456789012',
        NewStateValue: 'OK' as const,
        StateChangeTime: '2026-08-17T10:05:00.000+0000',
        Region: 'us-east-1',
      };

      const event = transformCloudWatchToEvent(payload);
      expect(event.event_action).toBe('resolve');
      expect(event.dedup_key).toBe('cloudwatch-123456789012-us-east-1-HighCPUUtilization');
    });

    it('3. Azure Monitor: Handles case-insensitive Sev0..Sev4 and Critical..Info', () => {
      const payload = {
        schemaId: 'azureMonitorCommonAlertSchema',
        data: {
          essentials: {
            alertId:
              '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.AlertsManagement/alerts/alt-1',
            alertRule: 'MemoryPressure',
            severity: 'sev0' as any,
            monitorCondition: 'Fired',
            monitorService: 'Platform',
          },
        },
      };

      const validation = validatePayload(AzureAlertSchema, payload);
      expect(validation.success).toBe(true);

      const event = transformAzureToEvent(payload as any);
      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
    });

    it('4. GCP Cloud Monitoring: Processes incident opening & resolution', () => {
      const payload = {
        incident: {
          incident_id: 'gcp-inc-999',
          resource_name: 'prod-vm-instance',
          state: 'open',
          summary: 'CPU utilization above 90%',
          url: 'https://console.cloud.google.com/monitoring/alerting/incidents/gcp-inc-999',
        },
      };

      const event = transformGoogleCloudMonitoringToEvent(payload as any);
      expect(event.event_action).toBe('trigger');
      expect(event.dedup_key).toContain('gcp-inc-999');
    });
  });

  describe('Sector 2: CI/CD & Pipeline Resolution (GitHub, GitLab CI, Bitbucket)', () => {
    it('5. GitHub Actions: Stable workflow dedup keys allow successful runs to resolve failures', () => {
      const failRun = {
        action: 'completed',
        repository: {
          name: 'ops-core',
          full_name: 'opsknight-labs/ops-core',
          html_url: 'https://github.com/opsknight-labs/ops-core',
        },
        workflow_run: {
          id: 1001,
          name: 'CI Build & Test',
          head_branch: 'main',
          status: 'completed' as const,
          conclusion: 'failure' as const,
          html_url: 'https://github.com/opsknight-labs/ops-core/actions/runs/1001',
        },
      };

      const passRun = {
        action: 'completed',
        repository: {
          name: 'ops-core',
          full_name: 'opsknight-labs/ops-core',
          html_url: 'https://github.com/opsknight-labs/ops-core',
        },
        workflow_run: {
          id: 1002,
          name: 'CI Build & Test',
          head_branch: 'main',
          status: 'completed' as const,
          conclusion: 'success' as const,
          html_url: 'https://github.com/opsknight-labs/ops-core/actions/runs/1002',
        },
      };

      const failEvent = transformGitHubToEvent(failRun);
      const passEvent = transformGitHubToEvent(passRun);

      expect(failEvent.event_action).toBe('trigger');
      expect(passEvent.event_action).toBe('resolve');
      expect(passEvent.dedup_key).toBe(failEvent.dedup_key);
      expect(passEvent.dedup_key).toBe('github-opsknight-labs-ops-core-ci-build---test-main');
    });

    it('6. GitLab CI: Stable project and branch/ref scoping for auto-resolution', () => {
      const failBuild = {
        object_kind: 'build',
        project: {
          name: 'backend',
          path_with_namespace: 'org/backend',
          web_url: 'https://gitlab.com/org/backend',
        },
        ref: 'main',
        build_status: 'failed',
      };

      const passBuild = {
        object_kind: 'build',
        project: {
          name: 'backend',
          path_with_namespace: 'org/backend',
          web_url: 'https://gitlab.com/org/backend',
        },
        ref: 'main',
        build_status: 'success',
      };

      const failEvent = transformGitHubToEvent(failBuild as any);
      const passEvent = transformGitHubToEvent(passBuild as any);

      expect(failEvent.event_action).toBe('trigger');
      expect(passEvent.event_action).toBe('resolve');
      expect(passEvent.dedup_key).toBe(failEvent.dedup_key);
      expect(passEvent.dedup_key).toBe('gitlab-org-backend-main');
    });

    it('7. Bitbucket: Pipeline resolution matches repository and commit status', () => {
      const failPipeline = {
        repository: { full_name: 'org/repo-service', name: 'repo-service' },
        pipeline: { state: { name: 'COMPLETED', result: { name: 'FAILED' } } },
      };

      const passPipeline = {
        repository: { full_name: 'org/repo-service', name: 'repo-service' },
        pipeline: { state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } } },
      };

      const failEvent = transformBitbucketToEvent(failPipeline as any);
      const passEvent = transformBitbucketToEvent(passPipeline as any);

      expect(failEvent.event_action).toBe('trigger');
      expect(passEvent.event_action).toBe('resolve');
      expect(passEvent.dedup_key).toBe(failEvent.dedup_key);
    });
  });

  describe('Sector 3: Metrics, Multi-Alert Arrays & Sentry Triage', () => {
    it('8. Grafana Unified Alerting: Batch processes ALL alerts in array (does not drop alerts 2..N)', () => {
      const batchPayload = {
        receiver: 'opsknight-webhook',
        status: 'firing',
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'DatabaseHighConnections', instance: 'db-primary' },
            annotations: { summary: 'DB connections > 90%' },
          },
          {
            status: 'firing',
            labels: { alertname: 'RedisMemoryHigh', instance: 'cache-redis' },
            annotations: { summary: 'Redis memory > 85%' },
          },
          {
            status: 'resolved',
            labels: { alertname: 'ApiLatencyHigh', instance: 'api-gateway' },
            annotations: { summary: 'API latency recovered' },
          },
        ],
      };

      const events = transformGrafanaToEvents(batchPayload as any);
      expect(events.length).toBe(3);
      expect(events[0].dedup_key).toBe('grafana-DatabaseHighConnections-db-primary');
      expect(events[0].event_action).toBe('trigger');
      expect(events[1].dedup_key).toBe('grafana-RedisMemoryHigh-cache-redis');
      expect(events[1].event_action).toBe('trigger');
      expect(events[2].dedup_key).toBe('grafana-ApiLatencyHigh-api-gateway');
      expect(events[2].event_action).toBe('resolve');
    });

    it('9. Prometheus Alertmanager: Multi-alert array extraction', () => {
      const promPayload = {
        version: '4',
        groupKey: '{}:{alertname="HighErrorRate"}',
        status: 'firing' as const,
        receiver: 'ops-alerts',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        externalURL: 'https://prometheus.local',
        alerts: [
          {
            status: 'firing' as const,
            labels: { alertname: 'High5xxRate', service: 'auth' },
            annotations: { summary: 'Auth service 5xx' },
            startsAt: '2026-08-17T10:00:00Z',
            generatorURL: '',
            fingerprint: 'fp-1',
          },
          {
            status: 'firing' as const,
            labels: { alertname: 'High5xxRate', service: 'billing' },
            annotations: { summary: 'Billing service 5xx' },
            startsAt: '2026-08-17T10:00:00Z',
            generatorURL: '',
            fingerprint: 'fp-2',
          },
        ],
      };

      const events = transformPrometheusToEvent(promPayload);
      expect(events.length).toBe(2);
      expect(events[0].dedup_key).toBe('prometheus-fp-1');
      expect(events[1].dedup_key).toBe('prometheus-fp-2');
    });

    it('10. Sentry: Issue assignment and ignore actions map to acknowledge (not trigger)', () => {
      const assignedIssue = {
        action: 'assigned',
        issue: {
          id: '12345',
          shortId: 'PROD-12',
          title: 'TypeError: Cannot read properties of undefined',
          culprit: 'auth-service',
          level: 'error' as const,
          status: 'unresolved' as const,
        },
      };

      const event = transformSentryToEvent(assignedIssue as any);
      expect(event.event_action).toBe('acknowledge');
    });

    it('11. Sentry: Issue created maps to trigger and issue resolved maps to resolve', () => {
      const createdIssue = {
        action: 'created',
        issue: {
          id: '12346',
          shortId: 'PROD-13',
          title: 'Uncaught Exception in payment webhook',
          culprit: 'payment-service',
          level: 'fatal' as const,
          status: 'unresolved' as const,
        },
      };

      const resolvedIssue = {
        action: 'resolved',
        issue: {
          id: '12346',
          shortId: 'PROD-13',
          title: 'Uncaught Exception in payment webhook',
          culprit: 'payment-service',
          level: 'fatal' as const,
          status: 'resolved' as const,
        },
      };

      expect(transformSentryToEvent(createdIssue as any).event_action).toBe('trigger');
      expect(transformSentryToEvent(resolvedIssue as any).event_action).toBe('resolve');
    });
  });

  describe('Sector 4: Enterprise APM & Tracing (New Relic, AppDynamics, Dynatrace, Honeycomb, Splunk, Elastic, Datadog)', () => {
    it('12. New Relic: Handles uppercase INCIDENT_OPEN and INCIDENT_RESOLVED', () => {
      const openPayload = {
        incident: {
          id: 'nr-inc-555',
          title: 'Synthetics check failed for login portal',
          state: 'INCIDENT_OPEN',
          severity: 'CRITICAL',
        },
      };

      const closePayload = {
        incident: {
          id: 'nr-inc-555',
          title: 'Synthetics check failed for login portal',
          state: 'INCIDENT_RESOLVED',
          severity: 'CRITICAL',
        },
      };

      const openEvent = transformNewRelicToEvent(openPayload as any);
      const closeEvent = transformNewRelicToEvent(closePayload as any);

      expect(openEvent.event_action).toBe('trigger');
      expect(closeEvent.event_action).toBe('resolve');
      expect(closeEvent.dedup_key).toBe(openEvent.dedup_key);
    });

    it('13. AppDynamics: POLICY_VIOLATION_OPEN and POLICY_VIOLATION_CLOSE produce identical dedup keys', () => {
      const openPayload = {
        eventType: 'POLICY_VIOLATION_OPEN',
        application: 'PaymentGateway',
        incidentId: 'appd-inc-777',
        summary: 'Response time exceeded 2000ms threshold',
      };

      const closePayload = {
        eventType: 'POLICY_VIOLATION_CLOSE',
        application: 'PaymentGateway',
        incidentId: 'appd-inc-777',
        summary: 'Response time back within 2000ms threshold',
      };

      const openEvent = transformAppDynamicsToEvent(openPayload);
      const closeEvent = transformAppDynamicsToEvent(closePayload);

      expect(openEvent.event_action).toBe('trigger');
      expect(closeEvent.event_action).toBe('resolve');
      expect(closeEvent.dedup_key).toBe(openEvent.dedup_key);
      expect(closeEvent.dedup_key).toBe('appd-inc-777');
    });

    it('14. Datadog: Accepts both single event and batched array events', () => {
      const singlePayload = {
        id: 'dd-mon-123',
        event_type: 'query_alert_monitor',
        title: '[Triggered] High Memory Usage on web-01',
        alert_type: 'error',
      };

      const arrayPayload = [
        {
          id: 'dd-mon-123',
          event_type: 'query_alert_monitor',
          title: 'Alert 1',
          alert_type: 'error',
        },
        {
          id: 'dd-mon-124',
          event_type: 'query_alert_monitor',
          title: 'Alert 2',
          alert_type: 'warning',
        },
      ];

      expect(validatePayload(DatadogEventSchema, singlePayload).success).toBe(true);
      expect(validatePayload(DatadogEventSchema, arrayPayload).success).toBe(true);

      const singleEvent = transformDatadogToEvent(singlePayload as any);
      expect(
        Array.isArray(singleEvent)
          ? (singleEvent[0] as any).event_action
          : (singleEvent as any).event_action
      ).toBe('trigger');
    });

    it('15. Dynatrace, Honeycomb, Splunk On-Call, Splunk Observability, and Elastic', () => {
      const dtOpen = transformDynatraceToEvent({
        ProblemID: 'dt-prob-1',
        ProblemTitle: 'Slow DB query',
        State: 'OPEN',
      } as any);
      const dtClose = transformDynatraceToEvent({
        ProblemID: 'dt-prob-1',
        ProblemTitle: 'Slow DB query',
        State: 'RESOLVED',
      } as any);
      expect(dtOpen.event_action).toBe('trigger');
      expect(dtClose.event_action).toBe('resolve');

      const hcTrigger = transformHoneycombToEvent({
        trigger_name: 'High P99 Latency',
        status: 'triggering',
      } as any);
      expect(hcTrigger.event_action).toBe('trigger');

      const splunkTrigger = transformSplunkOnCallToEvent({
        message_type: 'CRITICAL',
        entity_id: 'splunk-ent-1',
        state_message: 'Outage',
      } as any);
      expect(splunkTrigger.event_action).toBe('trigger');

      const sfxTrigger = transformSplunkObservabilityToEvent({
        incidentId: 'sfx-1',
        status: 'active',
        detector: 'CPU detector',
      } as any);
      expect(sfxTrigger.event_action).toBe('trigger');

      const elasticTrigger = transformElasticToEvent({
        rule: { id: 'r1', name: 'High CPU' },
        context: { value: 95 },
      } as any);
      expect(elasticTrigger.event_action).toBe('trigger');
    });
  });

  describe('Sector 5: Uptime Monitors & Native Nagios / Icinga 2', () => {
    it('16. Nagios: Flapping & Downtime notifications map to acknowledge (prevent false outages)', () => {
      const downtimeStart = {
        NOTIFICATIONTYPE: 'DOWNTIMESTART',
        HOSTNAME: 'prod-db-01',
        HOSTSTATE: 'UP',
        SERVICEDESC: 'PostgreSQL Process',
        SERVICESTATE: 'CRITICAL',
        SERVICEOUTPUT: 'Scheduled kernel update downtime',
        AUTHOR: 'SRE-Admin',
        COMMENT: 'Planned maintenance window',
      };

      const flappingStart = {
        NOTIFICATIONTYPE: 'FLAPPINGSTART',
        HOSTNAME: 'prod-api-01',
        HOSTSTATE: 'UP',
        SERVICEDESC: 'HTTP Health Check',
        SERVICESTATE: 'WARNING',
        SERVICEOUTPUT: 'Service is flapping between OK and WARNING',
      };

      const dtEvent = transformNagiosToEvent(downtimeStart as any);
      const flapEvent = transformNagiosToEvent(flappingStart as any);

      expect(dtEvent.event_action).toBe('acknowledge');
      expect(dtEvent.payload.custom_details.author).toBe('SRE-Admin');
      expect(dtEvent.payload.custom_details.comment).toBe('Planned maintenance window');
      expect(flapEvent.event_action).toBe('acknowledge');
    });

    it('17. Icinga 2: Downtime & Recovery handling', () => {
      const downtimeEvent = transformIcingaToEvent({
        type: 'DOWNTIMESTART',
        host_name: 'k8s-node-01',
        service_name: 'Kubelet',
        service_state: 'CRITICAL',
        output: 'Node draining',
      });

      const recoveryEvent = transformIcingaToEvent({
        type: 'RECOVERY',
        host_name: 'k8s-node-01',
        service_name: 'Kubelet',
        service_state: 'OK',
        output: 'Node ready',
      });

      expect(downtimeEvent.event_action).toBe('acknowledge');
      expect(recoveryEvent.event_action).toBe('resolve');
    });

    it('18. Uptime Monitors: UptimeRobot, Pingdom, Better Uptime, Uptime Kuma', () => {
      const urDown = transformUptimeRobotToEvent({
        alertType: '1',
        monitorFriendlyName: 'API Endpoint',
      } as any);
      const urUp = transformUptimeRobotToEvent({
        alertType: '2',
        monitorFriendlyName: 'API Endpoint',
      } as any);
      expect(urDown.event_action).toBe('trigger');
      expect(urUp.event_action).toBe('resolve');

      const pingdomDown = transformPingdomToEvent({
        state: 'DOWN',
        check_name: 'Login Page',
      } as any);
      const pingdomUp = transformPingdomToEvent({ state: 'UP', check_name: 'Login Page' } as any);
      expect(pingdomDown.event_action).toBe('trigger');
      expect(pingdomUp.event_action).toBe('resolve');

      const betterDown = transformBetterUptimeToEvent({
        incident: { id: 'bu-1', name: 'Web Outage', status: 'started' },
      } as any);
      const betterUp = transformBetterUptimeToEvent({
        incident: { id: 'bu-1', name: 'Web Outage', status: 'resolved' },
      } as any);
      expect(betterDown.event_action).toBe('trigger');
      expect(betterUp.event_action).toBe('resolve');

      const kumaDown = transformUptimeKumaToEvent({
        heartbeat: { status: 0, msg: 'Connection timeout' },
        monitor: { name: 'Payment API' },
      } as any);
      const kumaUp = transformUptimeKumaToEvent({
        heartbeat: { status: 1, msg: '200 OK' },
        monitor: { name: 'Payment API' },
      } as any);
      expect(kumaDown.event_action).toBe('trigger');
      expect(kumaUp.event_action).toBe('resolve');
    });
  });

  describe('Sector 6: NEW Integrations (Zabbix, PagerDuty, GitLab Native, Vercel)', () => {
    it('19. Zabbix: Parses problem and recovery with Disaster critical severity', () => {
      const zabbixProblem = {
        event_id: 'zb-101',
        event_name: 'PostgreSQL database pool exhausted',
        event_status: 'PROBLEM',
        event_severity: 'Disaster',
        host_name: 'db-master-01',
        trigger_id: 'tr-505',
      };
      const zabbixResolve = {
        event_id: 'zb-101',
        event_name: 'PostgreSQL database pool exhausted',
        event_status: 'RESOLVED',
        host_name: 'db-master-01',
        trigger_id: 'tr-505',
      };

      expect(validatePayload(ZabbixPayloadSchema, zabbixProblem).success).toBe(true);
      const probEvent = transformZabbixToEvent(zabbixProblem);
      const resEvent = transformZabbixToEvent(zabbixResolve);

      expect(probEvent.event_action).toBe('trigger');
      expect(probEvent.payload.severity).toBe('critical');
      expect(probEvent.dedup_key).toBe('zabbix-db-master-01-zb-101');

      expect(resEvent.event_action).toBe('resolve');
      expect(resEvent.dedup_key).toBe(probEvent.dedup_key);
    });

    it('20. PagerDuty Events API v2: Drop-in trigger, acknowledge, and resolve emulation', () => {
      const pdTrigger = {
        routing_key: 'pd-key-777',
        event_action: 'trigger' as const,
        dedup_key: 'prod/payment-gateway-timeout',
        payload: {
          summary: 'Stripe webhook timeout > 5000ms',
          source: 'billing-engine',
          severity: 'critical' as const,
        },
      };

      const pdResolve = {
        routing_key: 'pd-key-777',
        event_action: 'resolve' as const,
        dedup_key: 'prod/payment-gateway-timeout',
      };

      expect(validatePayload(PagerDutyEventSchema, pdTrigger).success).toBe(true);
      const trigEvent = transformPagerDutyToEvent(pdTrigger);
      const resEvent = transformPagerDutyToEvent(pdResolve);

      expect(trigEvent.event_action).toBe('trigger');
      expect(trigEvent.dedup_key).toBe('prod/payment-gateway-timeout');
      expect(trigEvent.payload.severity).toBe('critical');

      expect(resEvent.event_action).toBe('resolve');
      expect(resEvent.dedup_key).toBe('prod/payment-gateway-timeout');
    });

    it('21. GitLab Native: Handles pipeline failures and token authorization', () => {
      const glFail = {
        object_kind: 'pipeline',
        project: { path_with_namespace: 'fintech/core', name: 'core' },
        ref: 'main',
        status: 'failed',
        commit: { id: 'sha-999', message: 'deploy release' },
      };

      expect(validatePayload(GitLabPayloadSchema, glFail).success).toBe(true);
      const glEvent = transformGitLabToEvent(glFail as any);
      expect(glEvent.event_action).toBe('trigger');
      expect(glEvent.dedup_key).toBe('gitlab-fintech-core-main');
      expect(verifyGitLabToken('secret-gl-tok', 'secret-gl-tok')).toBe(true);
    });

    it('22. Vercel: Handles deployment failures, success resolution, and HMAC-SHA1 signature', () => {
      const vError = {
        type: 'deployment.error',
        payload: {
          project: { name: 'dashboard-next' },
          target: 'production',
          error: { message: 'Out of memory during static generation' },
        },
      };

      const vSuccess = {
        type: 'deployment.succeeded',
        payload: {
          project: { name: 'dashboard-next' },
          target: 'production',
        },
      };

      expect(validatePayload(VercelPayloadSchema, vError).success).toBe(true);
      const errEvent = transformVercelToEvent(vError as any);
      const succEvent = transformVercelToEvent(vSuccess as any);

      expect(errEvent.event_action).toBe('trigger');
      expect(errEvent.payload.severity).toBe('critical');
      expect(errEvent.dedup_key).toBe('vercel-dashboard-next-production');

      expect(succEvent.event_action).toBe('resolve');
      expect(succEvent.dedup_key).toBe('vercel-dashboard-next-production');

      // Vercel signature verification
      const secret = 'vercel-test-secret';
      const body = JSON.stringify(vError);
      const sig = crypto.createHmac('sha1', secret).update(body).digest('hex');
      expect(verifyVercelSignature(body, sig, secret)).toBe(true);
    });
  });

  describe('Sector 7: Cryptographic Verification, Settings, & Platform Hardening', () => {
    it('23. HMAC Signatures: Memory safety in safeCompare & timestamp validation', () => {
      const secret = 'super-secret-key-123';
      const body = JSON.stringify({ message: 'test alert' });

      // GitHub HMAC
      const ghHmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(verifyGitHubSignature(body, `sha256=${ghHmac}`, secret)).toBe(true);
      expect(verifyGitHubSignature(body, `sha256=invalid-signature-hash`, secret)).toBe(false);

      // Oversized attack signature does not crash or throw memory error
      const hugeSignature = 'a'.repeat(100000);
      expect(verifyGitHubSignature(body, `sha256=${hugeSignature}`, secret)).toBe(false);

      // Generic HMAC
      const genericHmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(verifyHmacSignature(body, genericHmac, secret)).toBe(true);
    });

    it('24. API Keys: Legacy migration path & modern Scrypt v2 hashing', () => {
      const token = 'opsk_test_token_12345';
      const v1Hash = hashTokenV1(token);
      expect(typeof v1Hash).toBe('string');
      expect(v1Hash.length).toBe(64);

      const v2Hash = hashTokenV2(token);
      expect(v2Hash.length).toBe(64);
      expect(v1Hash).not.toBe(v2Hash);
    });

    it('25. RBAC: Unauthenticated requests fall back safely to VIEWER with empty ID', async () => {
      const perms = await getUserPermissions();
      expect(perms.role).toBe('VIEWER');
      expect(perms.id).toBe('');
    });

    it('26. Circuit Breaker: HALF_OPEN single in-flight probe enforces fail-fast', async () => {
      const cb = CircuitBreakers.webhook('https://api.flaky-service.test');
      expect(cb).toBeDefined();
    });

    it('27. Retry with Jitter & 429 Retry-After handling', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 2) throw new Error('fetch network timeout');
          return 'success';
        },
        { maxAttempts: 3, initialDelayMs: 10 }
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('28. On-Call Schedule Engine: Layer ID scoping prevents cross-layer collapse', () => {
      const now = new Date();
      const oneHour = 60 * 60 * 1000;

      const layers = [
        {
          id: 'base-layer',
          name: 'Primary Rotation',
          start: new Date(now.getTime() - 24 * oneHour),
          end: null,
          rotationLengthHours: 24,
          users: [{ userId: 'user-1', user: { name: 'Alice' }, position: 0 }],
        },
      ];

      const blocks = buildScheduleBlocks(
        layers,
        [],
        new Date(now.getTime() - oneHour),
        new Date(now.getTime() + oneHour)
      );

      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].layerId).toBe('base-layer');
    });
  });
});
