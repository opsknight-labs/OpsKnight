import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformBetterUptimeToEvent, BetterUptimeEvent } from '@/lib/integrations/better-uptime';

export const POST = createIntegrationRoute<BetterUptimeEvent>(
  'BETTER_UPTIME',
  transformBetterUptimeToEvent,
  { signatureProvider: 'generic' }
);
