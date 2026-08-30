import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';
import { z } from 'zod';

const MAX_BODY_SIZE = 50 * 1024; // 50KB
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 logs per minute per IP
const ClientLogSchema = z.object({
  level: z.enum(['error', 'warn', 'debug', 'info']).optional(),
  message: z.string().trim().min(1).max(10_000),
  context: z.record(z.unknown()).optional(),
});

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
    if (!parsed.success) return NextResponse.json({ error: 'Invalid log payload' }, { status: 400 });

    const { level, message, context } = parsed.data;

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
