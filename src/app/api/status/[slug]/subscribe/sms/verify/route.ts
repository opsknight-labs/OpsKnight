import { NextRequest } from 'next/server';
import { verifySmsRequest } from '@/lib/status-pages/subscriber-channel-requests';

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return verifySmsRequest(req, slug);
}
