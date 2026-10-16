import { expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { finalizeVerificationEvidence } from '@/lib/runbooks/verification-evidence';
it('reports a missing historical version without attempting evidence mutations', async () => {
  const update = vi.fn();
  const tx = {
    $executeRaw: vi.fn(),
    runbookExecution: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ status: 'TIMED_OUT', runbookVersionId: 'missing', steps: [] }),
    },
    runbookVersion: { findUnique: vi.fn().mockResolvedValue(null) },
    runbookExecutionStep: { update },
  } as unknown as Prisma.TransactionClient;
  await expect(finalizeVerificationEvidence(tx, 'execution')).rejects.toThrow(
    'RUNBOOK_VERIFICATION_VERSION_MISSING'
  );
  expect(update).not.toHaveBeenCalled();
});
it('does not compute verification against nonterminal executions', async () => {
  const findVersion = vi.fn();
  const tx = {
    $executeRaw: vi.fn(),
    runbookExecution: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ status: 'CANCEL_REQUESTED' }),
    },
    runbookVersion: { findUnique: findVersion },
  } as unknown as Prisma.TransactionClient;
  await finalizeVerificationEvidence(tx, 'execution');
  expect(findVersion).not.toHaveBeenCalled();
});
it('ignores a delayed verification worker from an earlier execution revision', async () => {
  const findVersion = vi.fn();
  const update = vi.fn();
  const tx = {
    $executeRaw: vi.fn(),
    runbookExecution: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ status: 'SUCCEEDED', verificationRevision: 2 }),
    },
    runbookVersion: { findUnique: findVersion },
    runbookExecutionStep: { update },
  } as unknown as Prisma.TransactionClient;
  await finalizeVerificationEvidence(tx, 'execution', 1);
  expect(findVersion).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
