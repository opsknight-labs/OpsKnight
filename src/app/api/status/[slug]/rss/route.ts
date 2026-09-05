import { NextRequest } from 'next/server';
import { getStatusRssResponse } from '@/app/api/status/rss/route';

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return getStatusRssResponse(req, slug);
}
