import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  transformManageEngineToEvent,
  resolveManageEngineSeverity,
  resolveManageEngineAction,
  parseManageEnginePayload,
} from '@/lib/integrations/manageengine';
import { ManageEnginePayloadSchema, validatePayload } from '@/lib/integrations/schemas';
import { defaultAlertClassification } from '@/lib/incidents/classification-contract';

vi.mock('@/lib/prisma', () => ({
  default: {
    integration: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/events', () => ({
  processEvent: vi.fn(),
}));

vi.mock('@/lib/integrations/rate-limiter', () => ({
  checkRateLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 99, resetAt: Date.now() + 60000 }),
  createRateLimitHeaders: vi.fn().mockReturnValue({}),
}));

describe('ManageEngine Integration — Comprehensive Real-World Suite', () => {
  describe('1. OpManager Full 5-Poll Escalation & Recovery Lifecycle', () => {
    it('maintains a deterministic dedup_key across Attention -> Trouble -> Critical -> Acknowledge -> Clear', () => {
      // Poll 1: Attention (Yellow) -> warning (MEDIUM urgency)
      const poll1Attention = {
        alarmid: 4092,
        entity: 'core-router-01_CPU_Utilization',
        displayName: 'core-router-01',
        stringseverity: 'Attention',
        severity: 3,
        message: 'CPU Utilization is 78% (Attention Threshold: 75%)',
        ipAddress: '10.20.1.1',
        category: 'Routers',
        eventType: 'Threshold Violation',
        vendor: 'Cisco',
        strModTime: '25 Sep 2026 11:40:00 IST',
      };

      // Poll 3: Trouble (Orange) -> error (MEDIUM urgency)
      const poll3Trouble = {
        ...poll1Attention,
        stringseverity: 'Trouble',
        severity: 2,
        message: 'CPU Utilization is 88% (Trouble Threshold: 85%)',
        strModTime: '25 Sep 2026 11:43:00 IST',
      };

      // Poll 5: Critical (Red) -> critical (HIGH urgency)
      const poll5Critical = {
        ...poll1Attention,
        stringseverity: 'Critical',
        severity: 1,
        message: 'CPU Utilization is 98% (Critical Threshold: 95%)',
        strModTime: '25 Sep 2026 11:45:00 IST',
        url: 'https://opmanager.internal/apiclient/ember/index.jsp#/AlarmDetails/4092',
      };

      // Operator Acknowledgment in OpManager UI
      const operatorAck = {
        ...poll5Critical,
        action: 'ACKNOWLEDGE',
        ackUser: 'noc-lead',
        ackMessage: 'Investigating BGP route churn on core-router-01',
      };

      // Poll 6: Clear (Green) -> resolve
      const poll6Clear = {
        ...poll1Attention,
        stringseverity: 'Clear',
        severity: 5,
        message: 'CPU Utilization returned to normal (32%)',
        strModTime: '25 Sep 2026 11:50:00 IST',
      };

      const ev1 = transformManageEngineToEvent(poll1Attention);
      const ev3 = transformManageEngineToEvent(poll3Trouble);
      const ev5 = transformManageEngineToEvent(poll5Critical);
      const evAck = transformManageEngineToEvent(operatorAck);
      const evClear = transformManageEngineToEvent(poll6Clear);

      // Verify actions
      expect(ev1.event_action).toBe('trigger');
      expect(ev3.event_action).toBe('trigger');
      expect(ev5.event_action).toBe('trigger');
      expect(evAck.event_action).toBe('acknowledge');
      expect(evClear.event_action).toBe('resolve');

      // Verify severity & urgency progression
      expect(ev1.payload.severity).toBe('warning');
      expect(defaultAlertClassification(ev1.payload.severity).urgency).toBe('MEDIUM');

      expect(ev3.payload.severity).toBe('error');
      expect(defaultAlertClassification(ev3.payload.severity).urgency).toBe('MEDIUM');

      expect(ev5.payload.severity).toBe('critical');
      expect(defaultAlertClassification(ev5.payload.severity).urgency).toBe('HIGH');

      expect(evClear.payload.severity).toBe('info');

      // Verify identical deduplication key across the entire lifecycle
      const expectedKey = 'manageengine-core-router-01_cpu_utilization';
      expect(ev1.dedup_key).toBe(expectedKey);
      expect(ev3.dedup_key).toBe(expectedKey);
      expect(ev5.dedup_key).toBe(expectedKey);
      expect(evAck.dedup_key).toBe(expectedKey);
      expect(evClear.dedup_key).toBe(expectedKey);
    });

    it('correlates host-level availability alerts when $entity and $alarmid are omitted and message text changes', () => {
      const downAlert = transformManageEngineToEvent({
        displayName: 'dist-switch-04',
        stringseverity: 'Critical',
        message: 'Device dist-switch-04 is not responding to ping (5 consecutive polls failed)',
      });

      const upAlert = transformManageEngineToEvent({
        displayName: 'dist-switch-04',
        stringseverity: 'Clear',
        message: 'Device dist-switch-04 is up and responding (response time: 2ms)',
      });

      expect(downAlert.event_action).toBe('trigger');
      expect(upAlert.event_action).toBe('resolve');
      expect(downAlert.dedup_key).toBe('manageengine-dist-switch-04');
      expect(upAlert.dedup_key).toBe('manageengine-dist-switch-04');
    });
  });

  describe('2. Applications Manager Dual Health & Availability States', () => {
    it('does NOT falsely resolve when availability is "Up" but health is "Critical" or "Warning"', () => {
      const heapCritical = transformManageEngineToEvent({
        resourceid: '20491',
        resourcename: 'prod-checkout-jvm',
        monitortype: 'JMX-Application',
        attribute: 'Heap Memory Usage',
        availability: 'Up',
        health: 'Critical',
        message: 'Heap Memory Usage exceeded critical threshold (96% used)',
      });

      expect(heapCritical.event_action).toBe('trigger');
      expect(heapCritical.payload.severity).toBe('critical');
      expect(heapCritical.dedup_key).toBe('manageengine-20491-heap-memory-usage');

      const responseTimeWarn = transformManageEngineToEvent({
        resourceid: '20491',
        resourcename: 'prod-checkout-jvm',
        attribute: 'Response Time',
        availability: 'Up',
        health: 'Warning',
        message: 'Average response time is 1850ms',
      });

      expect(responseTimeWarn.event_action).toBe('trigger');
      expect(responseTimeWarn.payload.severity).toBe('warning');
    });

    it('triggers critical when availability is "Down" even if health is "Clear"', () => {
      const appDown = transformManageEngineToEvent({
        resourceid: '20491',
        resourcename: 'prod-checkout-jvm',
        availability: 'Down',
        health: 'Clear',
        message: 'Service port 8443 is unreachable',
      });

      expect(appDown.event_action).toBe('trigger');
      expect(appDown.payload.severity).toBe('critical');
    });

    it('resolves when both availability is "Up" and health is "Clear"', () => {
      const appRecovered = transformManageEngineToEvent({
        resourceid: '20491',
        resourcename: 'prod-checkout-jvm',
        attribute: 'Heap Memory Usage',
        availability: 'Up',
        health: 'Clear',
        message: 'Heap Memory Usage is back to normal (51% used)',
      });

      expect(appRecovered.event_action).toBe('resolve');
      expect(appRecovered.payload.severity).toBe('info');
      expect(appRecovered.dedup_key).toBe('manageengine-20491-heap-memory-usage');
    });
  });

  describe('3. Site24x7 & ServiceDesk Plus (ITSM) Payloads', () => {
    it('parses Site24x7 DOWN, TROUBLE, CRITICAL, and UP webhooks', () => {
      const siteDown = transformManageEngineToEvent({
        MONITOR_ID: 's247-99102',
        MONITOR_NAME: 'api.opsknight.com',
        MONITOR_GROUPNAME: 'Production APIs',
        STATUS: 'DOWN',
        INCIDENT_REASON: 'Connection timed out after 30000ms from Frankfurt probe',
        INCIDENT_TIME_ISO: '2026-09-25T06:45:00Z',
        MONITOR_URL: 'https://api.opsknight.com/health',
        RCA_LINK: 'https://www.site24x7.com/rca?id=99102',
      });

      expect(siteDown.event_action).toBe('trigger');
      expect(siteDown.payload.severity).toBe('critical');
      expect(siteDown.dedup_key).toBe('manageengine-s247-99102');
      expect(siteDown.payload.custom_details.alarmUrl).toBe(
        'https://www.site24x7.com/rca?id=99102'
      );

      const siteUp = transformManageEngineToEvent({
        MONITOR_ID: 's247-99102',
        MONITOR_NAME: 'api.opsknight.com',
        STATUS: 'UP',
        INCIDENT_REASON: 'Monitor is back UP (200 OK)',
      });

      expect(siteUp.event_action).toBe('resolve');
      expect(siteUp.dedup_key).toBe(siteDown.dedup_key);
    });

    it('unwraps ServiceDesk Plus nested request envelope and object-typed urgency/priority/status', () => {
      const rawSdpJson = JSON.stringify({
        request: {
          id: '19402',
          subject: 'Core SAN Storage Array Degraded in DC-West',
          description: 'RAID controller battery failed on storage-san-02',
          urgency: { id: '4', name: 'Urgent' },
          priority: { id: '3', name: 'Medium' },
          status: { id: '1', name: 'Open' },
          category: { id: '12', name: 'Storage' },
          technician: { id: '99', name: 'Priya Sharma' },
        },
      });

      const parsed = parseManageEnginePayload(rawSdpJson);
      const validation = validatePayload(ManageEnginePayloadSchema, parsed);
      expect(validation.success).toBe(true);

      const event = transformManageEngineToEvent(parsed);
      expect(event.event_action).toBe('trigger');
      // Urgent (critical) + Medium (warning) -> maxSeverity is critical (HIGH urgency)
      expect(event.payload.severity).toBe('critical');
      expect(event.payload.custom_details.urgency).toBe('Urgent');
      expect(event.payload.custom_details.priority).toBe('Medium');
      expect(event.payload.custom_details.category).toBe('Storage');
      expect(event.payload.custom_details.acknowledgedBy).toBe('Priya Sharma');
    });
  });

  describe('4. Malformed Raw JSON & Form-UrlEncoded Transport Resilience', () => {
    it('repairs OpManager raw JSON containing unescaped newlines, tabs, and trailing commas in $message', () => {
      // OpManager injects raw multi-line Windows Event Log / SNMP trap text directly into "$message"
      const rawBrokenOpManagerJson = `{
        "alarmid": "7741",
        "entity": "win-dc-01_EventLog_Security",
        "displayName": "win-dc-01",
        "stringseverity": "Critical",
        "message": "Account Lockout detected on win-dc-01:\n\tUser: svc_backup\r\n\tSource Workstation: 10.10.4.55\n\tFailure Reason: Bad password",
        "strModTime": "25 Sep 2026 12:15:00 IST",
      }`;

      const parsed = parseManageEnginePayload(rawBrokenOpManagerJson);
      const event = transformManageEngineToEvent(parsed);

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.dedup_key).toBe('manageengine-win-dc-01_eventlog_security');
      expect(event.payload.summary).toContain('Account Lockout detected on win-dc-01');
    });

    it('parses OpManager Form-UrlEncoded payloads and ServiceDesk Plus input_data form payloads', () => {
      const formBody =
        'alarmid=5012&entity=fw-edge-01_WAN_Status&displayName=fw-edge-01&stringseverity=Service+Down&severity=4&message=Primary+WAN+link+is+down';

      const parsedForm = parseManageEnginePayload(formBody);
      const event = transformManageEngineToEvent(parsedForm);

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.dedup_key).toBe('manageengine-fw-edge-01_wan_status');

      const sdpFormBody =
        'action=update&input_data=' +
        encodeURIComponent(
          JSON.stringify({
            request: {
              id: '8821',
              subject: 'VPN Concentrator High Latency',
              urgency: { name: 'Moderate' },
              status: { name: 'Resolved' },
            },
          })
        );

      const parsedSdp = parseManageEnginePayload(sdpFormBody);
      const sdpEvent = transformManageEngineToEvent(parsedSdp);
      expect(sdpEvent.event_action).toBe('resolve');
      expect(sdpEvent.payload.severity).toBe('info');
    });
  });

  describe('5. Substring Collision & False-Positive Immunity', () => {
    it('never misclassifies words containing "ack", "up", "normal", or "low" as false actions/severities', () => {
      // "Packet Loss", "Backup Failed", "Stack Down", "DDoS Attack" all contain "ack" or "up" as substrings
      expect(resolveManageEngineAction({ status: 'Packet Loss' })).toBe('trigger');
      expect(resolveManageEngineAction({ status: 'Backup Failed' })).toBe('trigger');
      expect(resolveManageEngineAction({ status: 'Stack Down' })).toBe('trigger');
      expect(resolveManageEngineAction({ status: 'DDoS Attack Detected' })).toBe('trigger');
      expect(resolveManageEngineAction({ status: 'Startup Failed' })).toBe('trigger');
      expect(resolveManageEngineAction({ action: 'UNACKNOWLEDGE' })).toBe('trigger');

      // "Abnormal" contains "normal"; "Below Threshold" contains "low"
      expect(resolveManageEngineSeverity({ status: 'Abnormal' })).toBe('warning');
      expect(resolveManageEngineSeverity({ status: 'Stack Down' })).toBe('critical');
      expect(resolveManageEngineSeverity({ stringseverity: 'High-Medium' })).toBe('error');
      expect(resolveManageEngineSeverity({ stringseverity: 'Low-Medium' })).toBe('warning');
    });
  });

  describe('6. End-to-End POST /api/integrations/manageengine Route Handler', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('accepts valid OpManager webhook POST and invokes processEvent with normalized payload', async () => {
      const prisma = (await import('@/lib/prisma')).default;
      const { processEvent } = await import('@/lib/events');
      const { POST } = await import('@/app/api/integrations/manageengine/route');

      vi.mocked(prisma.integration.findUnique).mockResolvedValue({
        id: 'int_me_01',
        type: 'MANAGEENGINE',
        serviceId: 'svc_network_01',
        enabled: true,
        signatureSecret: null,
        key: 'secret_me_key_123',
      } as any);

      vi.mocked(processEvent).mockResolvedValue({
        action: 'triggered',
        incident: { id: 'inc_9001', status: 'OPEN', urgency: 'HIGH' },
      } as any);

      const rawBody = JSON.stringify({
        alarmid: 9001,
        entity: 'core-sw-01_Port_Gi0/1',
        displayName: 'core-sw-01',
        stringseverity: 'Critical',
        severity: 1,
        ifName: 'GigabitEthernet0/1',
        message: 'Interface GigabitEthernet0/1 link state is DOWN',
      });

      const req = new NextRequest(
        'http://localhost:3000/api/integrations/manageengine?integrationId=int_me_01&integrationKey=secret_me_key_123',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawBody,
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(202);

      const json = await res.json();
      expect(json.status).toBe('success');
      expect(processEvent).toHaveBeenCalledTimes(1);
      expect(processEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_action: 'trigger',
          dedup_key: 'manageengine-core-sw-01_port_gi0-1',
          payload: expect.objectContaining({
            source: 'ManageEngine',
            severity: 'critical',
          }),
        }),
        'svc_network_01',
        'int_me_01'
      );
    });

    it('enforces HMAC-SHA256 signature verification when signatureSecret is configured and rejects invalid signatures or keys', async () => {
      const crypto = await import('crypto');
      const prisma = (await import('@/lib/prisma')).default;
      const { processEvent } = await import('@/lib/events');
      const { POST } = await import('@/app/api/integrations/manageengine/route');

      const hmacSecret = 'me_hmac_prod_secret_999';
      vi.mocked(prisma.integration.findUnique).mockResolvedValue({
        id: 'int_me_hmac',
        type: 'MANAGEENGINE',
        serviceId: 'svc_network_01',
        enabled: true,
        signatureSecret: hmacSecret,
        key: 'valid_me_key',
      } as any);

      vi.mocked(processEvent).mockResolvedValue({
        action: 'triggered',
        incident: { id: 'inc_9002', status: 'OPEN', urgency: 'HIGH' },
      } as any);

      const rawBody = JSON.stringify({
        alarmid: 9002,
        entity: 'db-prod-01_DiskUsage',
        displayName: 'db-prod-01',
        stringseverity: 'Service Down',
        severity: 4,
        message: 'Database service down on db-prod-01',
      });

      const validSig = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('hex');

      // 1. Valid HMAC signature -> 202 Accepted
      const validReq = new NextRequest(
        'http://localhost:3000/api/integrations/manageengine?integrationId=int_me_hmac&integrationKey=valid_me_key',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-signature': validSig,
          },
          body: rawBody,
        }
      );
      const validRes = await POST(validReq);
      expect(validRes.status).toBe(202);

      // 2. Invalid HMAC signature -> 401 Unauthorized
      const invalidSigReq = new NextRequest(
        'http://localhost:3000/api/integrations/manageengine?integrationId=int_me_hmac&integrationKey=valid_me_key',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-signature': 'deadbeef0000',
          },
          body: rawBody,
        }
      );
      const invalidSigRes = await POST(invalidSigReq);
      expect(invalidSigRes.status).toBe(401);

      // 3. Invalid integration key -> 400 INVALID_PAYLOAD
      const invalidKeyReq = new NextRequest(
        'http://localhost:3000/api/integrations/manageengine?integrationId=int_me_hmac&integrationKey=wrong_key',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-signature': validSig,
          },
          body: rawBody,
        }
      );
      const invalidKeyRes = await POST(invalidKeyReq);
      expect(invalidKeyRes.status).toBe(400);
    });

    it('maps all ManageEngine severity levels cleanly into OpsKnight Incident Urgency (LOW -> MEDIUM -> HIGH)', async () => {
      const { defaultAlertClassification } =
        await import('@/lib/incidents/classification-contract');

      // Information (6) / Low -> info -> LOW urgency
      const infoEvent = transformManageEngineToEvent({
        entity: 'sw-01_Config',
        stringseverity: 'Information',
        severity: 6,
        message: 'Configuration backed up',
      });
      expect(defaultAlertClassification(infoEvent.payload.severity).urgency).toBe('LOW');

      // Attention (3) / Medium / Moderate -> warning -> MEDIUM urgency
      const attentionEvent = transformManageEngineToEvent({
        entity: 'sw-01_CPU',
        stringseverity: 'Attention',
        severity: 3,
        message: 'CPU at 75%',
      });
      expect(defaultAlertClassification(attentionEvent.payload.severity).urgency).toBe('MEDIUM');

      // Trouble (2) / High -> error -> MEDIUM urgency
      const troubleEvent = transformManageEngineToEvent({
        entity: 'sw-01_CPU',
        stringseverity: 'Trouble',
        severity: 2,
        message: 'CPU at 88%',
      });
      expect(defaultAlertClassification(troubleEvent.payload.severity).urgency).toBe('MEDIUM');

      // Critical (1) / Service Down (4) / Urgent -> critical -> HIGH urgency
      const criticalEvent = transformManageEngineToEvent({
        entity: 'sw-01_CPU',
        stringseverity: 'Critical',
        severity: 1,
        message: 'CPU at 99%',
      });
      expect(defaultAlertClassification(criticalEvent.payload.severity).urgency).toBe('HIGH');
    });
  });
});
