import { NextRequest } from 'next/server';
import { revokeUserSessions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-url';
import { randomBytes, createHash } from 'crypto';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertAdmin } from '@/lib/rbac';
import { getClientIp } from '@/lib/client-ip';
import { emitAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    // Re-resolve the user from the database so role demotion and account
    // deactivation take effect without waiting for the JWT to expire.
    const sessionUser = await assertAdmin();

    // Rate Limit Admin Actions (Prevent mass generation)
    const ip = getClientIp(req.headers);
    const { checkRateLimit } = await import('@/lib/password-reset');
    try {
      // Use Admin's email to limit *their* activity
      await checkRateLimit(sessionUser.email, ip, 'ADMIN_GENERATED_RESET_LINK');
    } catch (error) {
      if (isAppError(error) && error.code === 'RATE_LIMIT_EXCEEDED') {
        return jsonError(
          new AppError({
            code: 'RATE_LIMIT_EXCEEDED',
            userMessage: 'Too many requests',
            cause: error,
          })
        );
      }
      throw error;
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(
        new AppError({
          code: 'INVALID_JSON',
          userMessage: 'Please check your input and try again.',
        })
      );
    }

    const userId =
      body && typeof body === 'object' && 'userId' in body
        ? (body as { userId?: unknown }).userId
        : undefined;

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'User ID is required',
          fields: [{ field: 'userId', code: 'required', message: 'User ID is required' }],
        })
      );
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'User not found',
          details: { resource: 'user', userId },
        })
      );
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
    await emitAuditEvent({
      action: 'ADMIN_GENERATED_RESET_LINK',
      source: 'API',
      target: { type: 'USER', id: user.id },
      actor: {
        type: 'USER',
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
      },
      requestId: req.headers.get('x-request-id'),
      targetEmail: user.email,
      ip,
      metadata: { generatedFor: user.id },
    });

    return jsonOk({ link: resetLink }, 200);
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('API Error /admin/generate-reset-link', {
      error,
      errorCode: 'INTERNAL_ERROR',
    });
    return jsonError('Internal Server Error', 500);
  }
}
