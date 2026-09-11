import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  acquireAdvisoryLock,
  acquireSharedAdvisoryLock,
  LOCK_KEYS,
} from '@/lib/db-locks';

/**
 * Jira HTTP calls are individually bounded to 8 seconds. A create workflow can
 * legitimately perform reconciliation + create + hydration, so leave bounded
 * transaction headroom above that three-request worst case while holding the
 * shared workspace fence.
 */
export const JIRA_PROVIDER_FENCE_TIMEOUT_MS = 40_000;
export const JIRA_PROVIDER_FENCE_MAX_WAIT_MS = 5_000;

function deterministicJiraLockKey(namespace: bigint, value: string): bigint {
  const digest = crypto.createHash('sha256').update(value).digest();
  const lower48 = digest.readBigUInt64BE(0) & BigInt('0x0000ffffffffffff');
  return namespace | lower48;
}

/**
 * Reserve a positive bigint namespace for per-action-item Jira link locks.
 * The high 16 bits are fixed ("JI"), while the low 48 bits come from SHA-256.
 * This avoids a global action-item mutex while keeping collision probability
 * negligible and keeping dynamic keys away from the small static LOCK_KEYS.
 */
export function jiraActionItemLinkLockKey(actionItemId: string): bigint {
  return deterministicJiraLockKey(BigInt('0x4a49000000000000'), actionItemId);
}

/**
 * Serialize ownership changes for one provider issue identity across every
 * OpsKnight entity. This closes the cross-entity race where two callers could
 * both observe an unlinked Jira key and then compete to own the same row.
 */
export function jiraExternalIssueLinkLockKey(provider: string, externalKey: string): bigint {
  return deterministicJiraLockKey(
    BigInt('0x4a4b000000000000'),
    `${provider.trim().toUpperCase()}\0${externalKey.trim().toUpperCase()}`
  );
}

export async function acquireJiraWorkspaceProviderFence(
  tx: Prisma.TransactionClient
): Promise<void> {
  await acquireSharedAdvisoryLock(tx, LOCK_KEYS.JIRA_WORKSPACE);

  const config = await tx.jiraConfig.findUnique({
    where: { id: 'default' },
    select: { enabled: true },
  });
  if (!config?.enabled) {
    throw new AppError({
      code: 'INTEGRATION_DISABLED',
      userMessage: 'Jira is not configured or is disabled.',
      action: 'Configure and enable Jira before using Jira workflows.',
      details: { provider: 'jira', reason: config ? 'disabled' : 'not_configured' },
    });
  }
}

export async function acquireJiraWorkspaceLifecycleFence(
  tx: Prisma.TransactionClient
): Promise<void> {
  await acquireAdvisoryLock(tx, LOCK_KEYS.JIRA_WORKSPACE);
}

export async function acquireJiraActionItemLinkFence(
  tx: Prisma.TransactionClient,
  actionItemId: string
): Promise<void> {
  await acquireAdvisoryLock(tx, jiraActionItemLinkLockKey(actionItemId));
}

export async function acquireJiraExternalIssueLinkFence(
  tx: Prisma.TransactionClient,
  provider: string,
  externalKey: string
): Promise<void> {
  await acquireAdvisoryLock(tx, jiraExternalIssueLinkLockKey(provider, externalKey));
}

/**
 * Hold the shared Jira workspace fence for a complete provider-facing workflow.
 * The callback may use ordinary Prisma clients; the transaction exists to own
 * the cluster-wide advisory lock and to re-check enabled state after waiting.
 */
export async function withJiraWorkspaceProviderFence<T>(work: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async tx => {
      await acquireJiraWorkspaceProviderFence(tx);
      return work();
    },
    {
      maxWait: JIRA_PROVIDER_FENCE_MAX_WAIT_MS,
      timeout: JIRA_PROVIDER_FENCE_TIMEOUT_MS,
    }
  );
}
