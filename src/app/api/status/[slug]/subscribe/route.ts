import { NextRequest } from 'next/server';
import { subscribeToStatusPage } from '@/app/api/status/subscribe/route';

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return subscribeToStatusPage(req, slug);
}
