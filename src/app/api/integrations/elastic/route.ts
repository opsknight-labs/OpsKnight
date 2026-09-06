import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformElasticToEvent, ElasticEvent } from '@/lib/integrations/elastic';

export const POST = createIntegrationRoute<ElasticEvent>('ELASTIC', transformElasticToEvent, {
  signatureProvider: 'generic',
});
