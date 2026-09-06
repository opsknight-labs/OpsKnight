import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformPingdomToEvent, PingdomEvent } from '@/lib/integrations/pingdom';

function parseBody(body: string): PingdomEvent {
  const trimmed = body.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as PingdomEvent;
  }
  const params = new URLSearchParams(trimmed);
  return Object.fromEntries(params.entries()) as PingdomEvent;
}

export const POST = createIntegrationRoute<PingdomEvent>('PINGDOM', transformPingdomToEvent, {
  signatureProvider: 'generic',
  parsePayload: parseBody,
});
