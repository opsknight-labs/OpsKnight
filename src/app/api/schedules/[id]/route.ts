import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { checkApiKeyRateLimit } from '@/lib/api-rate-limit';
import { getScheduleApiScope } from '@/lib/schedule-api-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const apiKey = await authenticateApiKey(req);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized. Missing or invalid API key.' },
        { status: 401 }
      );
    }
    if (!hasApiScopes(apiKey.scopes, ['schedules:read'])) {
      return NextResponse.json(
        { error: 'API key missing scope: schedules:read.' },
        { status: 403 }
      );
    }
    const rate = await checkApiKeyRateLimit('schedules', apiKey.id);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      );
    }

    const { id } = await params;
    const scheduleScope = await getScheduleApiScope(apiKey.userId);
    const schedule = await prisma.onCallSchedule.findFirst({
      where: { id, ...scheduleScope },
      select: {
        id: true,
        name: true,
        timeZone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });
    }

    return NextResponse.json({ schedule }, { status: 200 });
  } catch (error) {
    logger.error('api.schedules.get_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 });
  }
}
