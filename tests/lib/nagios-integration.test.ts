import { describe, it, expect } from 'vitest';
import { transformNagiosToEvent } from '@/lib/integrations/nagios';
import { NagiosPayloadSchema, validatePayload } from '@/lib/integrations/schemas';

describe('Nagios Integration', () => {
  describe('Schema Validation', () => {
    it('validates a standard Nagios service alert payload', () => {
      const payload = {
        NOTIFICATIONTYPE: 'PROBLEM',
        HOSTNAME: 'web-prod-01',
        HOSTADDRESS: '192.168.1.10',
        SERVICEDESC: 'HTTP Service',
        SERVICESTATE: 'CRITICAL',
        SERVICEOUTPUT: 'HTTP 500 Internal Server Error',
      };

      const result = validatePayload(NagiosPayloadSchema, payload);
      expect(result.success).toBe(true);
    });

    it('validates a lowercase Nagios payload', () => {
      const payload = {
        notificationtype: 'PROBLEM',
        hostname: 'db-prod-01',
        hoststate: 'DOWN',
        hostoutput: 'CRITICAL - Host Unreachable',
      };

      const result = validatePayload(NagiosPayloadSchema, payload);
      expect(result.success).toBe(true);
    });
  });

  describe('Payload Transformation', () => {
    it('transforms a service PROBLEM alert into a critical trigger event', () => {
      const event = transformNagiosToEvent({
        NOTIFICATIONTYPE: 'PROBLEM',
        HOSTNAME: 'web-prod-01',
        SERVICEDESC: 'CPU Load',
        SERVICESTATE: 'CRITICAL',
        SERVICEOUTPUT: 'CRITICAL - load average: 12.45, 10.12, 8.90',
      });

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.payload.source).toBe('Nagios');
      expect(event.dedup_key).toBe('nagios-web-prod-01-cpu-load');
      expect(event.payload.summary).toContain('CPU Load on web-prod-01 is CRITICAL');
      expect(event.payload.custom_details.hostname).toBe('web-prod-01');
      expect(event.payload.custom_details.service).toBe('CPU Load');
    });

    it('transforms a service WARNING alert into a warning trigger event', () => {
      const event = transformNagiosToEvent({
        notificationtype: 'PROBLEM',
        hostname: 'web-prod-02',
        servicedesc: 'Disk Space',
        servicestate: 'WARNING',
        serviceoutput: 'DISK WARNING - free space: / 15%',
      });

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('warning');
      expect(event.dedup_key).toBe('nagios-web-prod-02-disk-space');
    });

    it('transforms a service RECOVERY alert into a resolve event', () => {
      const event = transformNagiosToEvent({
        NOTIFICATIONTYPE: 'RECOVERY',
        HOSTNAME: 'web-prod-01',
        SERVICEDESC: 'CPU Load',
        SERVICESTATE: 'OK',
        SERVICEOUTPUT: 'OK - load average: 0.85, 0.90, 0.88',
      });

      expect(event.event_action).toBe('resolve');
      expect(event.payload.severity).toBe('info');
      expect(event.dedup_key).toBe('nagios-web-prod-01-cpu-load');
    });

    it('transforms a host DOWN alert into a critical trigger event', () => {
      const event = transformNagiosToEvent({
        NOTIFICATIONTYPE: 'PROBLEM',
        HOSTNAME: 'router-core-01',
        HOSTSTATE: 'DOWN',
        HOSTOUTPUT: 'CRITICAL - Host unreachable via ping',
      });

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.dedup_key).toBe('nagios-router-core-01');
      expect(event.payload.summary).toBe(
        'Host router-core-01 is DOWN: CRITICAL - Host unreachable via ping'
      );
    });

    it('transforms a host RECOVERY alert into a resolve event', () => {
      const event = transformNagiosToEvent({
        NOTIFICATIONTYPE: 'RECOVERY',
        HOSTNAME: 'router-core-01',
        HOSTSTATE: 'UP',
        HOSTOUTPUT: 'OK - Host is reachable',
      });

      expect(event.event_action).toBe('resolve');
      expect(event.payload.severity).toBe('info');
      expect(event.dedup_key).toBe('nagios-router-core-01');
    });

    it('transforms an ACKNOWLEDGEMENT alert into an acknowledge event', () => {
      const event = transformNagiosToEvent({
        NOTIFICATIONTYPE: 'ACKNOWLEDGEMENT',
        HOSTNAME: 'web-prod-01',
        SERVICEDESC: 'Memory Usage',
        SERVICESTATE: 'CRITICAL',
        SERVICEACKAUTHOR: 'ops-admin',
        SERVICEACKCOMMENT: 'Investigating high swap usage',
      });

      expect(event.event_action).toBe('acknowledge');
      expect(event.dedup_key).toBe('nagios-web-prod-01-memory-usage');
      expect(event.payload.custom_details.author).toBe('ops-admin');
      expect(event.payload.custom_details.comment).toBe('Investigating high swap usage');
    });
  });
});
