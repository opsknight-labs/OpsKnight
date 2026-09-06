import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformVercelToEvent } from '@/lib/integrations/vercel';
import type { VercelPayload } from '@/lib/integrations/schemas';

export const POST = createIntegrationRoute<VercelPayload>('VERCEL', transformVercelToEvent, {
  signatureProvider: 'vercel',
});
