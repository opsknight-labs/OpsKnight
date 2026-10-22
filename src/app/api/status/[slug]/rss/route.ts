import { NextRequest } from 'next/server';
import { getStatusRssResponse } from '@/lib/status-pages/rss';

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return getStatusRssResponse(req, slug);
}
