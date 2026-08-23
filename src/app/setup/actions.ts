'use server';

import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { redirect } from 'next/navigation';
import { logAudit, getDefaultActorId } from '@/lib/audit';
import { Prisma } from '@prisma/client';

const BOOTSTRAP_TRANSACTION_ATTEMPTS = 3;

function isTransactionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2034');
}

export async function bootstrapAdmin(formData: FormData) {
  const name = formData.get('name') as string;
  const email = (formData.get('email') as string)?.toLowerCase().trim();

  if (!name || !email) {
    return { error: 'Name and email are required.' };
  }

  const password = randomBytes(12).toString('hex').slice(0, 16);
  const passwordHash = await bcrypt.hash(password, 12);
  const defaultActorId = await getDefaultActorId();

  let user;
  for (let attempt = 1; attempt <= BOOTSTRAP_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      user = await prisma.$transaction(
        async tx => {
          const existing = await tx.user.count();
          if (existing > 0) {
            throw new Error('SYSTEM_ALREADY_INITIALIZED');
          }

          return tx.user.create({
            data: {
              name,
              email,
              role: 'ADMIN',
              status: 'ACTIVE',
              passwordHash,
              invitedAt: null,
              deactivatedAt: null,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'SYSTEM_ALREADY_INITIALIZED') {
        redirect('/login');
      }
      if (isTransactionConflict(error) && attempt < BOOTSTRAP_TRANSACTION_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }

  if (!user) throw new Error('Failed to initialize the system safely. Please retry.');

  await logAudit({
    action: 'user.bootstrap',
    entityType: 'USER',
    entityId: user.id,
    actorId: defaultActorId,
    details: { email },
  });

  return { success: true, password, email };
}
