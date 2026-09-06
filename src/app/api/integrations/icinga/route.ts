import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformIcingaToEvent, IcingaEvent } from '@/lib/integrations/icinga';

export const POST = createIntegrationRoute<IcingaEvent>('ICINGA', transformIcingaToEvent, {
  signatureProvider: 'generic',
});
