import { NextRequest } from 'next/server';
import { subscribeChatRequest } from '@/lib/status-pages/subscriber-channel-requests';

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return subscribeChatRequest(req, slug);
}
