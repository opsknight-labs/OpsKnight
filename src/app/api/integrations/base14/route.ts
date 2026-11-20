import { NextRequest } from 'next/server';
import { handleGrafanaWebhook } from '@/lib/integrations/grafana-webhook';

/**
 * base14 Scout Webhook Endpoint (Scout alerting is Grafana, so payloads are Grafana's)
 * POST /api/integrations/base14?integrationId=xxx
 */
export async function POST(req: NextRequest) {
  return handleGrafanaWebhook(req, 'BASE14', 'base14 Scout');
}
