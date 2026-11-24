import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { getEmbeddedView } from '@/lib/intelligence/dependencies/insights/views';

/**
 * Public, token-authenticated, read-only, anonymized graph (see getEmbeddedView). Off unless an
 * admin enables graphEmbed.enabled. Every failure is the same 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rate = await checkRateLimit(`api:graph-embed:ip:${getClientIp(req.headers)}`, 60, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  const view = await getEmbeddedView((await params).token);
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}
