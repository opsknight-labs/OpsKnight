import { NextRequest } from 'next/server';
import { subscribeWebhookRequest } from '@/lib/status-pages/subscriber-webhooks';

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return subscribeWebhookRequest(req, slug);
}
