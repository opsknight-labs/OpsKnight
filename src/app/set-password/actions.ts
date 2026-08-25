'use server';

import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { headers } from 'next/headers';
import { checkRateLimit, simulateWork } from '@/lib/password-reset';
import { validatePasswordStrength } from '@/lib/passwords';
import { createHash } from 'crypto';
import { getClientIp } from '@/lib/client-ip';

export async function setPassword(formData: FormData) {
  const startTime = Date.now();
  const token = formData.get('token') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  // 1. Rate Limiting
  const headerStore = await headers();
  const ip = getClientIp(headerStore);
  try {
    await checkRateLimit('unknown', ip, 'INVITE_FAILED');
  } catch (error) {
    redirect('/set-password?error=rate_limited');
  }

  if (!token) {
    redirect('/set-password?error=missing');
  }

  const passwordError = validatePasswordStrength(password || '');
  if (passwordError) {
    const code = passwordError.includes('include') ? 'complexity' : 'weak';
    redirect(`/set-password?token=${encodeURIComponent(token)}&error=${code}`);
  }

  if (password !== confirmPassword) {
    redirect(`/set-password?token=${encodeURIComponent(token)}&error=mismatch`);
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const record = await prisma.userToken.findFirst({
    where: {
      tokenHash,
      type: 'INVITE',
      usedAt: null,
    },
  });

  if (!record || record.expiresAt < new Date()) {
    // Log failure for rate limiting
    await logAudit({
      action: 'INVITE_FAILED',
      entityType: 'USER',
      entityId: 'unknown',
      actorId: null,
      details: { ip, reason: 'INVALID_TOKEN' },
    });
    await simulateWork(startTime);
    redirect('/set-password?error=expired');
  }

  const user = await prisma.user.findUnique({
    where: { email: record.identifier },
  });

  if (!user) {
    await logAudit({
      action: 'INVITE_FAILED',
      entityType: 'USER',
      entityId: 'unknown',
      actorId: null,
      details: { ip, reason: 'USER_NOT_FOUND' },
    });
    await simulateWork(startTime);
    redirect('/set-password?error=invalid');
  }

  // Security: Prevent using an invite link if the user is already active.
  // They should use "Forgot Password" instead.
  if (user.status === 'ACTIVE' && user.passwordHash) {
    await logAudit({
      action: 'INVITE_FAILED',
      entityType: 'USER',
      entityId: user.id,
      actorId: null,
      details: { ip, reason: 'ALREADY_ACTIVE' },
    });
    await simulateWork(startTime);
    redirect('/login?error=already_active');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          status: 'ACTIVE',
          tokenVersion: { increment: 1 },
          invitedAt: null,
          deactivatedAt: null,
        },
      });

      // Atomically claim THIS token. Concurrent submissions cannot both win.
      const claimed = await tx.userToken.updateMany({
        where: { tokenHash, type: 'INVITE', usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error('INVITE_TOKEN_ALREADY_USED');

      // Security: Invalidate ALL other INVITE tokens for this user to prevent reuse of old links
      await tx.userToken.deleteMany({
        where: {
          identifier: user.email,
          type: 'INVITE',
          NOT: { tokenHash }, // Don't delete the one we just marked used (for audit history), or just delete them all? Keeping history is better.
          // Actually, we just marked it used.
          // Let's delete *other* unused invite tokens.
          usedAt: null,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVITE_TOKEN_ALREADY_USED') {
      await simulateWork(startTime);
      redirect('/set-password?error=expired');
    }
    throw error;
  }

  await logAudit({
    action: 'user.active', // Changed action to standard user activation event
    entityType: 'USER',
    entityId: user.id,
    actorId: user.id, // User acting on themselves
    details: { method: 'invite', ip },
  });

  // Force sign-out effectively by redirecting to signout or letting the frontend handle it.
  // Since this is a server action, we can't easily clear the cookie domain-wide without auth hooks.
  // However, redirecting to the sign-out route with a callback to login is a safe way to ensure fresh session.
  redirect('/api/auth/signout?callbackUrl=/login?password=1');
}
