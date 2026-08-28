import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { checkApiKeyRateLimit } from '@/lib/api-rate-limit';
import { getScheduleApiScope } from '@/lib/schedule-api-auth';
import { resolveApiKeyActor } from '@/lib/authorization-actors';

function parseLimit(value: string | null) {
  const limit = Number(value);
  if (Number.isNaN(limit) || limit <= 0) return 50;
  return Math.min(limit, 200);
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = await authenticateApiKey(req);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized. Missing or invalid API key.' },
        { status: 401 }
      );
    }
    const rate = await checkApiKeyRateLimit('schedules', apiKey.id);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = parseLimit(searchParams.get('limit'));
    const actor = await resolveApiKeyActor(apiKey);
    if (!actor) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    let scheduleScope;
    try {
      scheduleScope = getScheduleApiScope(actor);
    } catch {
      return NextResponse.json({ error: 'Forbidden. Schedule access denied.' }, { status: 403 });
    }

    const schedules = await prisma.onCallSchedule.findMany({
      where: scheduleScope,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        timeZone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ schedules }, { status: 200 });
  } catch (error) {
    logger.error('api.schedules.fetch_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}
