import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

const MAX_BODY_SIZE = 50 * 1024; // 50KB
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 logs per minute per IP

export async function POST(req: NextRequest) {
  try {
    // Basic Rate Limiting by IP
    const ip = getClientIp(req.headers);
    const rate = await checkRateLimit(
      `api:logs:ingest:${ip}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Body size check
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_SIZE) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const body = await req.json();
    const { level, message, context } = body;

    // Ensure we don't log undefined
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const logContext = {
      ...context,
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
