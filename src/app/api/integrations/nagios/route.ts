import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformNagiosToEvent, NagiosEvent } from '@/lib/integrations/nagios';

export const POST = createIntegrationRoute<NagiosEvent>('NAGIOS', transformNagiosToEvent, {
  signatureProvider: 'generic',
});
