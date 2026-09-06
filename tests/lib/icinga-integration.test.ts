import { describe, it, expect } from 'vitest';
import { transformIcingaToEvent } from '@/lib/integrations/icinga';
import { IcingaPayloadSchema, validatePayload } from '@/lib/integrations/schemas';

describe('Icinga 2 Integration', () => {
  describe('Schema Validation', () => {
    it('validates a standard Icinga 2 service notification payload', () => {
      const payload = {
        notification_type: 'PROBLEM',
        host_name: 'srv-db-01.internal',
        service_name: 'PostgreSQL Connectivity',
        service_state: 'CRITICAL',
        service_output: 'CRITICAL - could not connect to server: Connection refused',
        check_command: 'check_pgsql',
      };

      const result = validatePayload(IcingaPayloadSchema, payload);
      expect(result.success).toBe(true);
    });

    it('validates a camelCase Icinga 2 payload', () => {
      const payload = {
        notificationType: 'PROBLEM',
        hostName: 'srv-app-01',
        hostState: 'DOWN',
        hostOutput: 'CRITICAL - ping timeout',
      };

      const result = validatePayload(IcingaPayloadSchema, payload);
      expect(result.success).toBe(true);
    });
  });

  describe('Payload Transformation', () => {
    it('transforms a service PROBLEM alert into a critical trigger event', () => {
      const event = transformIcingaToEvent({
        notification_type: 'PROBLEM',
        host_name: 'srv-db-01.internal',
        service_name: 'PostgreSQL Connectivity',
        service_state: 'CRITICAL',
        service_output: 'CRITICAL - connection refused',
        check_command: 'check_pgsql',
      });

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.payload.source).toBe('Icinga');
      expect(event.dedup_key).toBe('icinga-srv-db-01.internal-postgresql-connectivity');
      expect(event.payload.summary).toContain(
        'PostgreSQL Connectivity on srv-db-01.internal is CRITICAL'
      );
      expect(event.payload.custom_details.checkCommand).toBe('check_pgsql');
    });

    it('transforms a service WARNING alert into a warning trigger event', () => {
      const event = transformIcingaToEvent({
        notification_type: 'PROBLEM',
        host_name: 'srv-app-01',
        service_name: 'Disk Usage',
        service_state: 'WARNING',
        service_output: 'DISK WARNING - /data is at 85% capacity',
      });

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('warning');
      expect(event.dedup_key).toBe('icinga-srv-app-01-disk-usage');
    });

    it('transforms a service RECOVERY alert into a resolve event', () => {
      const event = transformIcingaToEvent({
        notification_type: 'RECOVERY',
        host_name: 'srv-db-01.internal',
        service_name: 'PostgreSQL Connectivity',
        service_state: 'OK',
        service_output: 'OK - connected successfully',
      });

      expect(event.event_action).toBe('resolve');
      expect(event.payload.severity).toBe('info');
      expect(event.dedup_key).toBe('icinga-srv-db-01.internal-postgresql-connectivity');
    });

    it('transforms a host DOWN alert into a critical trigger event', () => {
      const event = transformIcingaToEvent({
        notification_type: 'PROBLEM',
        host_name: 'gateway-router-01',
        host_state: 'DOWN',
        host_output: 'CRITICAL - Host packet loss 100%',
      });

      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.dedup_key).toBe('icinga-gateway-router-01');
      expect(event.payload.summary).toBe(
        'Host gateway-router-01 is DOWN: CRITICAL - Host packet loss 100%'
      );
    });

    it('transforms a host RECOVERY alert into a resolve event', () => {
      const event = transformIcingaToEvent({
        notification_type: 'RECOVERY',
        host_name: 'gateway-router-01',
        host_state: 'UP',
        host_output: 'PING OK - Packet loss = 0%, RTA = 0.50 ms',
      });

      expect(event.event_action).toBe('resolve');
      expect(event.payload.severity).toBe('info');
      expect(event.dedup_key).toBe('icinga-gateway-router-01');
    });

    it('transforms an ACKNOWLEDGEMENT into an acknowledge event', () => {
      const event = transformIcingaToEvent({
        notification_type: 'ACKNOWLEDGEMENT',
        host_name: 'srv-db-01',
        service_name: 'Replication Lag',
        service_state: 'CRITICAL',
        author: 'dba-team',
        comment: 'WAL sync in progress',
      });

      expect(event.event_action).toBe('acknowledge');
      expect(event.dedup_key).toBe('icinga-srv-db-01-replication-lag');
      expect(event.payload.custom_details.author).toBe('dba-team');
      expect(event.payload.custom_details.comment).toBe('WAL sync in progress');
    });
  });
});
