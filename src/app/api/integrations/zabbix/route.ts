import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformZabbixToEvent, ZabbixEvent } from '@/lib/integrations/zabbix';

export const POST = createIntegrationRoute<ZabbixEvent>('ZABBIX', transformZabbixToEvent, {
  signatureProvider: 'generic',
});
