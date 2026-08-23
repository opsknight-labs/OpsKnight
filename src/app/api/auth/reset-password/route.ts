import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { revokeUserSessions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, password } = body;

    // Get IP for rate limiting
    const rawIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const ip = rawIp.split(',')[0].trim();

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
