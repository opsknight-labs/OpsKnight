import { describe, it, expect } from 'vitest';
import { transformZabbixToEvent } from '@/lib/integrations/zabbix';
import { ZabbixPayloadSchema, validatePayload } from '@/lib/integrations/schemas';

describe('Zabbix Webhooks Integration', () => {
  it('should parse a problem event as trigger with high severity', () => {
    const payload = {
      event_id: 1001,
      trigger_id: 500,
      event_name: 'CPU load is too high on db-server-01',
      event_status: 'PROBLEM',
      event_value: '1',
      event_severity: 'High',
      host_name: 'db-server-01',
      host_ip: '10.0.0.5',
      item_name: 'Processor load (1 min average)',
      item_value: '5.2',
      event_url: 'https://zabbix.internal/tr_events.php?triggerid=500&eventid=1001',
      event_opdata: 'Current load: 5.2',
    };

    const validation = validatePayload(ZabbixPayloadSchema, payload);
    expect(validation.success).toBe(true);

    const event = transformZabbixToEvent(payload as any);
    expect(event.event_action).toBe('trigger');
    expect(event.payload.severity).toBe('error'); // High maps to error
    // Dedup key should prioritize event_id (1001) over trigger_id (500)
    expect(event.dedup_key).toBe('zabbix-db-server-01-1001');
    expect(event.payload.custom_details.hostIp).toBe('10.0.0.5');
    expect(event.payload.custom_details.eventUrl).toBe(
      'https://zabbix.internal/tr_events.php?triggerid=500&eventid=1001'
    );
    expect(event.payload.custom_details.eventOpdata).toBe('Current load: 5.2');
  });

  it('should parse a recovery event as resolve', () => {
    const payload = {
      event_id: 1001, // Note: Zabbix recovery sends the original problem's event_id
      event_name: 'CPU load is too high on db-server-01',
      event_status: 'OK',
      event_value: '0',
      event_severity: 'High',
      host_name: 'db-server-01',
    };

    const event = transformZabbixToEvent(payload as any);
    expect(event.event_action).toBe('resolve');
    expect(event.dedup_key).toBe('zabbix-db-server-01-1001');
  });

  it('should parse an acknowledgment event as acknowledge', () => {
    const payload = {
      event_id: 1001,
      event_name: 'CPU load is too high on db-server-01',
      action: 'ACKNOWLEDGE',
      ack_user: 'Admin',
      ack_message: 'Looking into this now',
      host_name: 'db-server-01',
    };

    const event = transformZabbixToEvent(payload as any);
    expect(event.event_action).toBe('acknowledge');
    expect(event.dedup_key).toBe('zabbix-db-server-01-1001');
    expect(event.payload.custom_details.ackUser).toBe('Admin');
    expect(event.payload.custom_details.ackMessage).toBe('Looking into this now');
  });

  it('should map all Zabbix severities correctly', () => {
    // 0 = Not classified (info)
    expect(transformZabbixToEvent({ event_severity: '0' } as any).payload.severity).toBe('info');
    // 1 = Information (info)
    expect(transformZabbixToEvent({ event_severity: '1' } as any).payload.severity).toBe('info');
    // 2 = Warning (warning)
    expect(transformZabbixToEvent({ event_severity: '2' } as any).payload.severity).toBe('warning');
    // 3 = Average (warning)
    expect(transformZabbixToEvent({ event_severity: '3' } as any).payload.severity).toBe('warning');
    // 4 = High (error)
    expect(transformZabbixToEvent({ event_severity: '4' } as any).payload.severity).toBe('error');
    // 5 = Disaster (critical)
    expect(transformZabbixToEvent({ event_severity: '5' } as any).payload.severity).toBe(
      'critical'
    );
    // Missing severity should default to warning
    expect(transformZabbixToEvent({} as any).payload.severity).toBe('warning');
  });
});
