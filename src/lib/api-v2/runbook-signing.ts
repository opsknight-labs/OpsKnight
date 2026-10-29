import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { RunbookSigningRotationError } from '@/lib/runbooks/execution-signing';
export const SigningKeyParams = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9-]+$/),
  })
  .strict();
export const SigningKeySelect = {
  id: true,
  publicKey: true,
  state: true,
  createdAt: true,
  activatedAt: true,
  retiredAt: true,
} satisfies Prisma.RunbookExecutionSigningKeySelect;
export async function guardActiveSigningIdentity(
  tx: Prisma.TransactionClient,
  expectedId: string | null
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runbook-signing-rotation'))`;
  const active = await tx.runbookExecutionSigningKey.findFirst({
    where: { state: 'ACTIVE' },
    select: { id: true },
  });
  if ((active?.id ?? null) !== expectedId)
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage:
        'Active signing identity changed. Read the signing identities and review rotation again.',
    });
}
export async function signingCommand<T>(command: () => Promise<T>): Promise<T> {
  try {
    return await command();
  } catch (error) {
    if (error instanceof RunbookSigningRotationError)
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: error.message });
    throw error;
  }
}
