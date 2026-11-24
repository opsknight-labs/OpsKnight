import { NextRequest } from 'next/server';
import { unsubscribeWebhookRequest } from '@/lib/status-pages/subscriber-webhooks';

// GET so the link in a payload works from a browser; POST for machine callers.
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  return unsubscribeWebhookRequest(params.get('id'), params.get('token'));
}
export const POST = GET;
