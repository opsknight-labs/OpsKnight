import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v3';
import { getRequestActorContext } from '@/lib/request-actor-context';
import {
  getResponderDashboardSnapshot,
  ResponderDashboardUnavailableError,
} from '@/lib/dashboard/responder-dashboard-snapshot';
import {
  getInternalOperationalStatusSnapshot,
  InternalOperationalStatusBusyError,
} from '@/lib/status/internal-operational-status-snapshot';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { READ_MODEL_POLICY } from '@/lib/read-model-policy';

const RefreshRequestSchema = z
  .object({
    pathname: z
      .string()
      .min(1)
      .max(512)
      .refine(value => value === '/m' || value.startsWith('/m/')),
    search: z.string().max(2048).optional().default(''),
  })
  .strict();

export async function POST(request: NextRequest) {
  const context = await getRequestActorContext();
  if (!context) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = RefreshRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REFRESH_REQUEST' }, { status: 400 });
  }

  const { pathname } = parsed.data;

  try {
    if (pathname === '/m') {
      await getResponderDashboardSnapshot(
        context.actor,
        context.user.id,
        READ_MODEL_POLICY.REQUIRE_FRESH
      );
    } else if (pathname === '/m/status') {
      await getInternalOperationalStatusSnapshot(context.actor, READ_MODEL_POLICY.REQUIRE_FRESH);
    }
  } catch (error) {
    // All recalculation slots are taken: say so and when to retry, instead of a bare 500.
    if (
      error instanceof ResponderDashboardUnavailableError ||
      error instanceof InternalOperationalStatusBusyError
    ) {
      return NextResponse.json(
        { error: 'REFRESH_BUSY' },
        { status: 503, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' } }
      );
    }
    throw error;
  }

  const generation = await getRealtimeChangeGeneration().catch(() => null);
  return NextResponse.json(
    { ok: true, generation, refreshedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
