import { NextRequest } from 'next/server';
import { subscribeSmsRequest } from '@/lib/status-pages/subscriber-channel-requests';

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return subscribeSmsRequest(req, slug);
}
