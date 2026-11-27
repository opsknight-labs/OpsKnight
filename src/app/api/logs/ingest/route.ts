import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { resolveAuthPublicOrigin } from '@/lib/auth-public-origin';
import { getAuthoritativeRequestHost, parseHostname } from '@/lib/request-host';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';
import { z } from 'zod/v3';

const MAX_BODY_SIZE = 50 * 1024; // 50KB
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 logs per minute per IP
const GLOBAL_RATE_LIMIT_MAX = 600; // across every address, so many IPs cannot add up to a flood
const UNAVAILABLE_RETRY_AFTER_SECONDS = 5;
const ClientLogSchema = z.object({
  level: z.enum(['error', 'warn', 'debug', 'info']).optional(),
  message: z.string().trim().min(1).max(10_000),
  context: z.record(z.unknown()).optional(),
});

/**
 * Only the app's own pages should post here. A browser sets Sec-Fetch-Site and Origin itself and page
 * script cannot change them; tools without an Origin (curl, server code) are not browsers and still
 * pass through the limits below. The origin is compared by host with the one this request was served on
 * (honouring TRUST_PROXY_HEADERS) or the public address the deployment is configured with.
 */
function crossOriginReason(req: NextRequest): 'cross_site' | 'origin_mismatch' | null {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return 'cross_site';
  const origin = req.headers.get('origin');
  if (origin === null) return null;
  const configured = resolveAuthPublicOrigin();
  const ownHosts = new Set([
    getAuthoritativeRequestHost(req),
    ...(configured.source === 'DEVELOPMENT_FALLBACK' ? [] : [parseHostname(configured.origin)]),
  ]);
  const originHost = parseHostname(origin);
  return originHost && ownHosts.has(originHost) ? null : 'origin_mismatch';
}

function tooManyRequests(
  rate: { resetAt: number; unavailable?: boolean },
  reason: 'ip' | 'global_quota'
) {
  // The counter store failing says nothing about the caller's quota: tell it to retry shortly, not that it is limited.
  if (rate.unavailable) {
    return NextResponse.json(
      { error: 'Log ingestion is temporarily unavailable' },
      { status: 503, headers: { 'Retry-After': String(UNAVAILABLE_RETRY_AFTER_SECONDS) } }
    );
  }
  // Counted, not logged: the endpoint is open, so a flood must not turn into a flood of log lines.
  if (reason === 'global_quota') {
    addOperationalMetric('opsknight_log_ingest_rejections_total', 1, { reason });
  }
  const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const crossOrigin = crossOriginReason(req);
    if (crossOrigin) {
      addOperationalMetric('opsknight_log_ingest_rejections_total', 1, { reason: crossOrigin });
      return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 });
    }

    // Basic Rate Limiting by IP
    const ip = getClientIp(req.headers);
    const rate = await checkRateLimit(
      `api:logs:ingest:${ip}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) return tooManyRequests(rate, 'ip');

    // One shared quota behind the per-address one: a flood from many addresses stops here.
    const globalRate = await checkRateLimit(
      'api:logs:ingest-global',
      GLOBAL_RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!globalRate.allowed) return tooManyRequests(globalRate, 'global_quota');

    let body: unknown;
    try {
      body = JSON.parse(await readIntegrationBody(req, MAX_BODY_SIZE));
    } catch (error) {
      if (error instanceof IntegrationBodyTooLargeError) {
        return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
      }
      return NextResponse.json({ error: 'Invalid log payload' }, { status: 400 });
    }

    const parsed = ClientLogSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid log payload' }, { status: 400 });

    const { level, message, context } = parsed.data;

    // This endpoint is unauthenticated. The logger lifts component, requestId, userId, duration
    // and error to first-class log fields, so a caller must not be able to set them: keep what
    // the client claimed under one key instead.
    const { component, requestId, userId, duration, error, ...clientFields } = context ?? {};
    const logContext = {
      ...clientFields,
      clientClaims: { component, requestId, userId, duration, error },
      source: 'client',
      userAgent: req.headers.get('user-agent'),
    };

    switch (level) {
      case 'error':
        logger.error(message, logContext);
        break;
      case 'warn':
        logger.warn(message, logContext);
        break;
      case 'debug':
        logger.debug(message, logContext);
        break;
      case 'info':
      default:
        logger.info(message, logContext);
        break;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // Internal server error logging fallback
    logger.error('Failed to ingest client log', { error });
    return NextResponse.json({ error: 'Failed to ingest log' }, { status: 500 });
  }
}
