import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { updateIncidentStatus } from '@/app/(app)/incidents/actions';

const StatusSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']),
  expectedStatus: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']).optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return jsonError('Unauthorized', 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError('Invalid JSON in request body.', 400);
    }

    const parsed = StatusSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }

    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    if (idempotencyKey) {
      const { checkRateLimit } = await import('@/lib/rate-limit');
      const once = await checkRateLimit(
        `mobile-idempotency:${session.user.email}:${idempotencyKey}`,
        1,
        24 * 60 * 60 * 1000
      );
      if (!once.allowed) return jsonOk({ success: true, duplicate: true }, 200);
    }

    await updateIncidentStatus(params.id, parsed.data.status, parsed.data.expectedStatus);
    return jsonOk({ success: true }, 200);
  } catch (error) {
    logger.error('api.mobile.incident.update_failed', {
      component: 'mobile-incident-status',
      error,
      incidentId: params.id,
    });
    return jsonError('Failed to update incident.', 500);
  }
}

export const POST = PATCH;
