import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { acquireAdvisoryLock, acquireSharedAdvisoryLock, LOCK_KEYS } from '@/lib/db-locks';

/**
 * Jira HTTP calls are individually bounded to 8 seconds. A create workflow can
 * legitimately perform reconciliation + create + hydration, so leave bounded
 * transaction headroom above that three-request worst case while holding the
 * shared workspace fence.
 */
export const JIRA_PROVIDER_FENCE_TIMEOUT_MS = 40_000;
export const JIRA_PROVIDER_FENCE_MAX_WAIT_MS = 5_000;
const JIRA_ISSUE_MUTATION_FENCE_TIMEOUT_MS = 15_000;

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
 * Serialize ownership changes and inbound mutations for one provider issue
 * identity across every OpsKnight entity and replica.
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
 * Hold a short transaction-scoped lock while a local Jira mutation chain runs.
 * Webhook processing performs no provider HTTP calls, so this serializes the
 * stale-check + DB side effects without holding a connection on Atlassian I/O.
 */
export async function withJiraIssueMutationFence<T>(
  provider: string,
  externalKeyOrId: string,
  work: () => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async tx => {
      await acquireJiraExternalIssueLinkFence(tx, provider, externalKeyOrId);
      return work();
    },
    {
      maxWait: JIRA_PROVIDER_FENCE_MAX_WAIT_MS,
      timeout: JIRA_ISSUE_MUTATION_FENCE_TIMEOUT_MS,
    }
  );
}

/**
 * Hold the shared Jira workspace fence for a complete provider-facing workflow.
 * The callback may use ordinary Prisma clients; the transaction exists to own
 * the cluster-wide advisory lock and to re-check enabled state after waiting.
 */
export async function withJiraWorkspaceProviderFence<T>(work: () => Promise<T>): Promise<T> {
  return runJiraProviderTransaction(async tx => {
    await acquireJiraWorkspaceProviderFence(tx);
    return work();
  });
}

/**
 * Bulkhead for Jira workflows that hold a database connection across provider HTTP. When Atlassian
 * slows down, at most this many such workflows run per process, so they cannot pin the whole pool
 * and starve unrelated incident traffic. The rest wait here, holding no connection.
 */
export const JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS = Math.max(
  1,
  Number(process.env.JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS) || 4
);
let active = 0;
const waiting: Array<() => void> = [];

async function acquireJiraBulkhead(): Promise<void> {
  if (active < JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS) {
    active++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const turn = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(turn), 1);
      reject(
        new AppError({
          code: 'RATE_LIMIT_EXCEEDED',
          userMessage: 'Jira is busy right now.',
          action: 'Try again in a moment.',
          details: { provider: 'jira', reason: 'bulkhead_full' },
        })
      );
    }, JIRA_PROVIDER_FENCE_MAX_WAIT_MS);
    waiting.push(turn);
  });
}

function releaseJiraBulkhead(): void {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

/** The one way to open a transaction that spans Jira provider I/O: bulkheaded, fenced timeouts. */
export async function runJiraProviderTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  await acquireJiraBulkhead();
  try {
    return await prisma.$transaction(work, {
      maxWait: JIRA_PROVIDER_FENCE_MAX_WAIT_MS,
      timeout: JIRA_PROVIDER_FENCE_TIMEOUT_MS,
    });
  } finally {
    releaseJiraBulkhead();
  }
}
