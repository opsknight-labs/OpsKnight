import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { completePasswordReset } from '@/lib/password-reset';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS } from '@/lib/passwords';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/client-ip';
import { readJsonBodyWithLimit } from '@/lib/request-body';

const schema = z
  .object({
    token: z.string().min(32).max(512),
    // Transport guard only. validatePasswordStrength() owns the semantic
    // Unicode-code-point and bcrypt-byte limits.
    password: z.string().min(1).max(PASSWORD_TRANSPORT_MAX_CODE_UNITS),
  })
  .strict();

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await readJsonBodyWithLimit(req, 8192));
    if (!parsed.success) return json({ error: 'Invalid reset request.' }, 400);
    const result = await completePasswordReset(
      parsed.data.token,
      parsed.data.password,
      getClientIp(req.headers)
    );
    if (!result.success) {
      return json(
        { error: result.error || 'Unable to reset password.' },
        result.code === 'RATE_LIMITED' ? 429 : result.code === 'INTERNAL' ? 500 : 400
      );
    }
    return json({ message: result.message }, 200);
  } catch (error) {
    logger.error('auth.password_reset.complete_route_failed', {
      component: 'reset-password-route',
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Unable to reset password.' }, 500);
  }
}
