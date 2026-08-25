import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { resolveEscalationTarget } from '@/lib/escalation';
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
    const rate = await checkApiKeyRateLimit('schedules:oncall', apiKey.id, 60);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      );
    }

    const { id } = await params;

    // Verify schedule exists
    const scheduleScope = await getScheduleApiScope(apiKey.userId);
    const schedule = await prisma.onCallSchedule.findFirst({
      where: { id, ...scheduleScope },
      select: { id: true },
    });

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });
    }

    // Get time parameter or use now
    const url = new URL(req.url);
    const atParam = url.searchParams.get('at');
    const atTime = atParam ? new Date(atParam) : new Date();

    if (isNaN(atTime.getTime())) {
      return NextResponse.json({ error: 'Invalid "at" timestamp parameter.' }, { status: 400 });
    }

    // Resolve users for the schedule
    const userIds = await resolveEscalationTarget('SCHEDULE', id, atTime);

    // Fetch user details
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    // Format response to match required structure
    const oncall = users.map(user => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    }));

    return NextResponse.json(
      {
        scheduleId: id,
        at: atTime.toISOString(),
        oncall,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('api.schedules.oncall.get_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch on-call users' }, { status: 500 });
  }
}
