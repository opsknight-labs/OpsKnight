import 'server-only';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { hasCapability, CAPABILITIES, type AppRole } from '@/lib/authorization';
import { runSerializableTransaction } from '@/lib/db-utils';
import { requireOperationalUser } from '@/lib/users/operational-eligibility';

export const IncidentWatcherSchema = z
  .object({
    incidentId: z.string().trim().min(1).max(100),
    userId: z.string().trim().min(1).max(100),
    role: z.enum(['FOLLOWER', 'STAKEHOLDER', 'EXEC']).default('FOLLOWER'),
  })
  .strict();
type WatcherActor = { id: string; role: AppRole };

/** Adapters must establish incident visibility before permitting self-subscription. */
export async function setIncidentWatcher(
  raw: z.input<typeof IncidentWatcherSchema>,
  actor: WatcherActor,
  client?: Prisma.TransactionClient
) {
  const input = IncidentWatcherSchema.parse(raw);
  if (
    !hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE) &&
    (input.userId !== actor.id || input.role !== 'FOLLOWER')
  ) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'You may only subscribe yourself as a follower.',
    });
  }
  const command = async (tx: Prisma.TransactionClient) => {
    await requireOperationalUser(tx, input.userId);
    const current = await tx.incidentWatcher.findUnique({
      where: { incidentId_userId: { incidentId: input.incidentId, userId: input.userId } },
    });
    if (current?.role === input.role) return current;
    const watcher = await tx.incidentWatcher.upsert({
      where: { incidentId_userId: { incidentId: input.incidentId, userId: input.userId } },
      update: { role: input.role },
      create: input,
    });
    await tx.incidentEvent.create({
      data: {
        incidentId: input.incidentId,
        type: 'LEGACY_OTHER',
        message: `Watcher added (${input.role})`,
      },
    });
    return watcher;
  };
  return client ? command(client) : runSerializableTransaction(command);
}

export async function deleteIncidentWatcher(
  incidentId: string,
  watcherId: string,
  actor: WatcherActor,
  client?: Prisma.TransactionClient
) {
  const input = z
    .object({
      incidentId: z.string().trim().min(1).max(100),
      watcherId: z.string().trim().min(1).max(100),
    })
    .strict()
    .parse({ incidentId, watcherId });
  const command = async (tx: Prisma.TransactionClient) => {
    const watcher = await tx.incidentWatcher.findFirst({
      where: { id: input.watcherId, incidentId: input.incidentId },
    });
    if (!watcher) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (!hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE) && watcher.userId !== actor.id) {
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'You may only unsubscribe yourself.',
      });
    }
    const removed = await tx.incidentWatcher.deleteMany({
      where: { id: watcher.id, incidentId: input.incidentId, userId: watcher.userId },
    });
    if (removed.count !== 1) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    await tx.incidentEvent.create({
      data: { incidentId: input.incidentId, type: 'LEGACY_OTHER', message: 'Watcher removed' },
    });
    return { id: watcher.id, incidentId: input.incidentId, removed: true };
  };
  return client ? command(client) : runSerializableTransaction(command);
}
