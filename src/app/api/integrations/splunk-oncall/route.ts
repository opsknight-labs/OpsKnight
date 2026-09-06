import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformSplunkOnCallToEvent, SplunkOnCallEvent } from '@/lib/integrations/splunk-oncall';

export const POST = createIntegrationRoute<SplunkOnCallEvent>(
  'SPLUNK_ONCALL',
  transformSplunkOnCallToEvent,
  { signatureProvider: 'generic' }
);
