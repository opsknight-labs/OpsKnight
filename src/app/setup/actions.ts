'use server';

import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';
import { PASSWORD_TRANSPORT_MAX_CODE_UNITS, validatePasswordStrength } from '@/lib/passwords';

const BOOTSTRAP_TRANSACTION_ATTEMPTS = 3;
const BOOTSTRAP_RATE_WINDOW_MS = 15 * 60 * 1000;

const schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(PASSWORD_TRANSPORT_MAX_CODE_UNITS),
    confirmPassword: z.string().min(1).max(PASSWORD_TRANSPORT_MAX_CODE_UNITS),
  })
  .strict();

function isTransactionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2034');
}

function constantTimeUtf8Equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export async function bootstrapAdmin(formData: FormData) {
  const parsed = schema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) return { error: 'Check the setup fields and try again.' };

  const { name, password, confirmPassword } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  if (!constantTimeUtf8Equal(password, confirmPassword)) {
    return { error: 'Passwords do not match.' };
  }
  const passwordError = validatePasswordStrength(password, { email, displayName: name });
  if (passwordError) return { error: passwordError };

  const headerStore = await headers();
  const ip = getClientIp(headerStore);
  const ipRate = await consumeAuthRateLimit('bootstrap:ip', ip, 20, BOOTSTRAP_RATE_WINDOW_MS);
  if (!ipRate.allowed) {
    return { error: 'Setup temporarily unavailable. Please try again later.' };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let user: { id: string; email: string } | undefined;

  for (let attempt = 1; attempt <= BOOTSTRAP_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      user = await prisma.$transaction(
        async tx => {
          if ((await tx.user.count()) > 0) throw new Error('SYSTEM_ALREADY_INITIALIZED');

          const created = await tx.user.create({
            data: {
              name,
              email,
              role: 'ADMIN',
              status: 'ACTIVE',
              passwordHash,
              invitedAt: null,
              deactivatedAt: null,
            },
            select: { id: true, email: true },
          });

          await logAudit(
            {
              action: 'user.bootstrap',
              entityType: 'USER',
              entityId: created.id,
              actorId: created.id,
              source: 'AUTH',
              details: { method: 'initial_setup' },
            },
            tx
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (error) {
      if (error instanceof Error && error.message === 'SYSTEM_ALREADY_INITIALIZED') {
        redirect('/login');
      }
      if (isTransactionConflict(error) && attempt < BOOTSTRAP_TRANSACTION_ATTEMPTS) continue;
      throw error;
    }
  }

  if (!user) return { error: 'Unable to initialize the system safely. Please retry.' };

  try {
    revalidatePath('/login');
    revalidatePath('/setup');
  } catch {
    // Safe in environments where static generation store is not available
  }

  return { success: true, email: user.email };
}
