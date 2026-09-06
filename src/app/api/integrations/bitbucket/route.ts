import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformBitbucketToEvent, BitbucketEvent } from '@/lib/integrations/bitbucket';

export const POST = createIntegrationRoute<BitbucketEvent>('BITBUCKET', transformBitbucketToEvent, {
  signatureProvider: 'generic',
});
