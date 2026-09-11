import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { initiatePasswordReset } from '@/lib/password-reset';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/client-ip';
import { readJsonBodyWithLimit } from '@/lib/request-body';

const GENERIC_MESSAGE =
  'If an account exists with this email, you will receive password reset instructions.';
const schema = z
  .object({
    email: z.string().trim().email().max(254),
  })
  .strict();

function response() {
  return NextResponse.json(
    { message: GENERIC_MESSAGE },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await readJsonBodyWithLimit(req, 4096));
    if (!parsed.success) return response();
    await initiatePasswordReset(parsed.data.email, getClientIp(req.headers));
    return response();
  } catch (error) {
    logger.error('auth.password_reset.request_route_failed', {
      component: 'forgot-password-route',
      error: error instanceof Error ? error.message : String(error),
    });
    return response();
  }
}
