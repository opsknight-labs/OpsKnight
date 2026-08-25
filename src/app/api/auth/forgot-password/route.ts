import { NextRequest, NextResponse } from 'next/server';
import { initiatePasswordReset } from '@/lib/password-reset';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/client-ip';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Get IP for rate limiting
    const ip = getClientIp(req.headers);

    const result = await initiatePasswordReset(email, ip);

    return NextResponse.json({ message: result.message }, { status: 200 });
  } catch (error) {
    logger.error('API Error /auth/forgot-password', { error });
    return NextResponse.json(
      {
        message:
          'If an account exists with this email, you will receive password reset instructions.',
      },
      { status: 200 }
    ); // Always return 200 Security hygiene
  }
}
