import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformAppDynamicsToEvent, AppDynamicsEvent } from '@/lib/integrations/appdynamics';

export const POST = createIntegrationRoute<AppDynamicsEvent>(
  'APPDYNAMICS',
  transformAppDynamicsToEvent,
  { signatureProvider: 'generic' }
);
