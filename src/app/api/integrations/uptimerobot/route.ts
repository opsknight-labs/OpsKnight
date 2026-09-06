import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import { transformUptimeRobotToEvent, UptimeRobotEvent } from '@/lib/integrations/uptimerobot';

function parseBody(body: string): UptimeRobotEvent {
  const trimmed = body.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as UptimeRobotEvent;
  }
  const params = new URLSearchParams(trimmed);
  return Object.fromEntries(params.entries()) as UptimeRobotEvent;
}

export const POST = createIntegrationRoute<UptimeRobotEvent>(
  'UPTIMEROBOT',
  transformUptimeRobotToEvent,
  { signatureProvider: 'generic', parsePayload: parseBody }
);
