import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/client-ip';
import { getLocalAuthPolicy } from '@/lib/local-auth-policy';

export async function POST(req: NextRequest) {
  if (!getLocalAuthPolicy().localLoginEnabled) {
    return NextResponse.json(
      { error: 'Local password authentication is disabled.' },
      { status: 403 }
    );
  }
  try {
    const body = await req.json();
    const { token, password } = body;

    // Get IP for rate limiting
    const ip = getClientIp(req.headers);

    // Call shared logic which handles validation, rate limiting, hashing, and logging
    const { completePasswordReset } = await import('@/lib/password-reset');
    const result = await completePasswordReset(token, password, ip);

    if (!result.success) {
      // Determine status code based on error
      const status = result.error?.includes('Too many') ? 429 : 400;
      return NextResponse.json({ error: result.error || 'Failed to reset password' }, { status });
    }

    return NextResponse.json({ message: result.message }, { status: 200 });
  } catch (error) {
    logger.error('API Error /auth/reset-password', { error });
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
