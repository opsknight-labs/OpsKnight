import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformDynatraceToEvent, DynatraceEvent } from '@/lib/integrations/dynatrace';

export const POST = createIntegrationRoute<DynatraceEvent>('DYNATRACE', transformDynatraceToEvent, {
  signatureProvider: 'generic',
});
