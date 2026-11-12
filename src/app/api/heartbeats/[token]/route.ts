import type { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { checkRateLimit } from '@/lib/integrations/rate-limiter';
import { hashHeartbeatToken } from '@/lib/intelligence/noise-controls/manage';
import { recordHeartbeat } from '@/lib/intelligence/noise-controls/heartbeats';

export const dynamic = 'force-dynamic';

/**
 * Heartbeat ping: `GET` or `POST /api/heartbeats/<token>`. The token is the only credential, so the
 * response never reveals whether a token exists (unknown and paused both answer 404). Pings are
 * rate limited per token; a missing ping raises an incident through the normal ingestion path.
 */
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

async function ping(_req: NextRequest, params: Promise<{ token: string }>) {
  const { token } = await params;
  if (!TOKEN.test(token)) return jsonError('Not found', 404);
  const limit = await checkRateLimit(`heartbeat:${hashHeartbeatToken(token).slice(0, 16)}`, {
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) return jsonError('Too many pings', 429);
  const outcome = await recordHeartbeat(token);
  if (outcome === 'unknown' || outcome === 'paused') return jsonError('Not found', 404);
  return jsonOk({ status: outcome });
}

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  return ping(req, context.params);
}

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  return ping(req, context.params);
}
