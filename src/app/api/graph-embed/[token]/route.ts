import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { getEmbeddedView } from '@/lib/intelligence/dependencies/insights/views';

/**
 * Public, token-authenticated, read-only, anonymized graph (see getEmbeddedView). Off unless an
 * admin enables graphEmbed.enabled. Every failure is the same 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rate = await checkRateLimit(`api:graph-embed:ip:${getClientIp(req.headers)}`, 60, 60_000);
  if (!rate.allowed) return jsonError('Rate limit exceeded', 429);
  const view = await getEmbeddedView((await params).token);
  if (!view) return jsonError('Not found', 404);
  return jsonOk(view, 200, { 'Cache-Control': 'no-store' });
}
