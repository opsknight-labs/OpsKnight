import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformUptimeKumaToEvent, UptimeKumaEvent } from '@/lib/integrations/uptime-kuma';

export const POST = createIntegrationRoute<UptimeKumaEvent>(
  'UPTIME_KUMA',
  transformUptimeKumaToEvent,
  { signatureProvider: 'generic' }
);
