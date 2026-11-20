import { NextRequest } from 'next/server';
import { handleGrafanaWebhook } from '@/lib/integrations/grafana-webhook';

/**
 * Grafana Webhook Endpoint
 * POST /api/integrations/grafana?integrationId=xxx
 */
export async function POST(req: NextRequest) {
  return handleGrafanaWebhook(req, 'GRAFANA', 'Grafana');
}
