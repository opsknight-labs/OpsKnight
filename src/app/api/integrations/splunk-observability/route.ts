import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import {
  transformSplunkObservabilityToEvent,
  SplunkObservabilityEvent,
} from '@/lib/integrations/splunk-observability';

export const POST = createIntegrationRoute<SplunkObservabilityEvent>(
  'SPLUNK_OBSERVABILITY',
  transformSplunkObservabilityToEvent,
  { signatureProvider: 'generic' }
);
