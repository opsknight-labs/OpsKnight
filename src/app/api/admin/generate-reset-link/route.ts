import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions, revokeUserSessions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-url';
import { randomBytes, createHash } from 'crypto';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    // 1. Auth Check (Admin Only)
    const session = await getServerSession(await getAuthOptions());
    const sessionUser = session?.user as { id: string; role: string; email: string } | undefined;

    if (!sessionUser || sessionUser.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Rate Limit Admin Actions (Prevent mass generation)
    const rawIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const ip = rawIp.split(',')[0].trim();
    const { checkRateLimit } = await import('@/lib/password-reset');
    try {
      // Use Admin's email to limit *their* activity
      await checkRateLimit(sessionUser.email, ip, 'ADMIN_GENERATED_RESET_LINK');
    } catch (e) {
      if (e instanceof Error && e.message.includes('Too many')) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
      throw e;
    }

    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 2. Generate Token
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const identifier = user.email.toLowerCase();

    // 3. Save Token (invalidate any existing unused admin links)
    await prisma.userToken.deleteMany({
      where: {
        identifier,
        type: 'PASSWORD_RESET',
        usedAt: null,
      },
    });

    await prisma.userToken.create({
      data: {
        identifier,
        type: 'PASSWORD_RESET',
        tokenHash,
        expiresAt: expires,
        metadata: { generatedBy: sessionUser.id },
      },
    });

    // Revoke active sessions for target user to prevent hijacked sessions from persisting
    await revokeUserSessions(user.id);

    // 4. Construct Link
    const appUrl = await getAppUrl();
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    // 5. Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_GENERATED_RESET_LINK',
        entityType: 'USER',
        entityId: user.id,
        actorId: sessionUser.id,
        targetEmail: sessionUser.email,
        ip,
        details: { targetEmail: user.email, generatedFor: user.id },
      },
    });

    return NextResponse.json({ link: resetLink });
  } catch (error) {
    logger.error('API Error /admin/generate-reset-link', { error });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
