import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformHoneycombToEvent, HoneycombEvent } from '@/lib/integrations/honeycomb';

export const POST = createIntegrationRoute<HoneycombEvent>('HONEYCOMB', transformHoneycombToEvent, {
  signatureProvider: 'generic',
});
