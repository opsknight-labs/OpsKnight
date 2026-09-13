import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { isAppError } from '@/lib/errors';
import {
  createJiraIssue,
  findJiraIssueByCorrelationLabel,
  type JiraIssueSummary,
  addJiraComment,
  hasJiraCommentMarker,
} from '@/lib/jira';
import {
  acquireJiraActionItemLinkFence,
  acquireJiraExternalIssueLinkFence,
  acquireJiraWorkspaceProviderFence,
  JIRA_PROVIDER_FENCE_MAX_WAIT_MS,
  JIRA_PROVIDER_FENCE_TIMEOUT_MS,
} from '@/lib/jira-concurrency';
import {
  assertProviderAdmitted,
  recordProviderFailure,
  recordProviderSuccess,
} from '@/lib/provider-admission';

const LEASE_MS = 5 * 60_000;
const MAX_JIRA_OPERATION_ATTEMPTS = 8;
const JIRA_PROVIDER_KEY = 'jira:workspace';

export type JiraCreateOperationInput = {
  incidentId?: string;
  actionItemId?: string;
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string | null;
  labels?: string[];
  component?: string | null;
};

type JiraCommentOperationInput = {
  incidentId: string;
  externalKey: string;
  eventId: string;
  comment: string;
};

type TransactionClient = Prisma.TransactionClient;

type ProviderFailureOptions = {
  statusCode?: number;
  retryAfterMs?: number;
};

class TerminalJiraOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalJiraOperationError';
  }
}

function jiraCreateKey(input: JiraCreateOperationInput): string {
  const owner = input.incidentId
    ? `incident:${input.incidentId}`
    : input.actionItemId
      ? `action-item:${input.actionItemId}`
      : `request:${crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
  return `jira:create:${owner}`;
}

function assertExactlyOneCreateOwner(input: JiraCreateOperationInput): void {
  const ownerCount = Number(Boolean(input.incidentId)) + Number(Boolean(input.actionItemId));
  if (ownerCount !== 1) {
    throw new Error('A Jira create operation must belong to exactly one OpsKnight entity.');
  }
}

function jiraProviderFailureOptions(error: unknown): ProviderFailureOptions | null {
  if (!isAppError(error) || error.details?.provider !== 'jira') return null;
  const status = error.details.providerStatus;
  const retryAfter = error.details.providerRetryAfterMs;
  return {
    ...(typeof status === 'number' && Number.isFinite(status)
      ? { statusCode: Math.trunc(status) }
      : {}),
    ...(typeof retryAfter === 'number' && Number.isFinite(retryAfter)
      ? { retryAfterMs: Math.max(1_000, Math.trunc(retryAfter)) }
      : {}),
  };
}

function operationRetryDelayMs(error: unknown): number {
  return jiraProviderFailureOptions(error)?.retryAfterMs ?? 30_000;
}

function operationFailureStatus(attempts: number): 'FAILED' | 'AMBIGUOUS' {
  return attempts >= MAX_JIRA_OPERATION_ATTEMPTS ? 'FAILED' : 'AMBIGUOUS';
}

export async function enqueueJiraCommentOperations(
  inputs: JiraCommentOperationInput[]
): Promise<{ attempted: number; pending: number }> {
  return prisma.$transaction(tx => enqueueJiraCommentOperationsInTransaction(tx, inputs));
}

/** Atomically persists Jira delivery intents with the source domain mutation. */
export async function enqueueJiraCommentOperationsInTransaction(
  tx: TransactionClient,
  inputs: JiraCommentOperationInput[]
): Promise<{ attempted: number; pending: number }> {
  let pending = 0;
  for (const input of inputs) {
    const idempotencyKey = `jira:comment:${input.externalKey}:${input.eventId}`;
    const existing = await tx.externalOperation.findUnique({
      where: { provider_idempotencyKey: { provider: 'JIRA', idempotencyKey } },
      select: { id: true },
    });
    if (existing) continue;
    const operation = await tx.externalOperation.create({
      data: {
        provider: 'JIRA',
        operation: 'ADD_COMMENT',
        idempotencyKey,
        incidentId: input.incidentId,
        externalKey: input.externalKey,
        requestPayload: input as Prisma.InputJsonObject,
      },
    });
    await tx.backgroundJob.create({
      data: {
        type: 'EXTERNAL_OPERATION',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: MAX_JIRA_OPERATION_ATTEMPTS,
        payload: { operationId: operation.id },
      },
    });
    pending++;
  }
  return { attempted: inputs.length, pending };
}

export async function enqueueJiraCreateOperation(input: JiraCreateOperationInput): Promise<string> {
  assertExactlyOneCreateOwner(input);
  const idempotencyKey = jiraCreateKey(input);
  return prisma.$transaction(async tx => {
    const existing = await tx.externalOperation.findUnique({
      where: { provider_idempotencyKey: { provider: 'JIRA', idempotencyKey } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const operation = await tx.externalOperation.create({
      data: {
        provider: 'JIRA',
        operation: 'CREATE_ISSUE',
        idempotencyKey,
        incidentId: input.incidentId ?? null,
        actionItemId: input.actionItemId ?? null,
        requestPayload: input as Prisma.InputJsonObject,
      },
    });
    await tx.backgroundJob.create({
      data: {
        type: 'EXTERNAL_OPERATION',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: MAX_JIRA_OPERATION_ATTEMPTS,
        payload: { operationId: operation.id },
      },
    });
    return operation.id;
  });
}

async function claimOperation(id: string) {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.externalOperation.updateMany({
    where: {
      id,
      nextAttemptAt: { lte: now },
      OR: [
        { status: { in: ['PENDING', 'FAILED', 'AMBIGUOUS'] } },
        { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: 'PROCESSING',
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  const operation = await prisma.externalOperation.findUnique({ where: { id } });
  return operation ? { operation, leaseToken } : null;
}

function parseJiraCreatePayload(value: Prisma.JsonValue | null): JiraCreateOperationInput {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Jira operation payload is missing');
  }
  const input = value as Record<string, Prisma.JsonValue>;
  if (
    typeof input.projectKey !== 'string' ||
    typeof input.issueType !== 'string' ||
    typeof input.summary !== 'string'
  ) {
    throw new Error('Jira operation payload is invalid');
  }
  const parsed = value as unknown as JiraCreateOperationInput;
  assertExactlyOneCreateOwner(parsed);
  return parsed;
}

function operationFailureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

const providerFenceTransactionOptions = {
  maxWait: JIRA_PROVIDER_FENCE_MAX_WAIT_MS,
  timeout: JIRA_PROVIDER_FENCE_TIMEOUT_MS,
};

async function releaseFailedOperation(
  id: string,
  leaseToken: string,
  attempts: number,
  error: unknown
): Promise<void> {
  await prisma.externalOperation.updateMany({
    where: { id, status: 'PROCESSING', leaseToken },
    data: {
      status: operationFailureStatus(attempts),
      nextAttemptAt: new Date(Date.now() + operationRetryDelayMs(error)),
      lastError: operationFailureMessage(error),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

export async function processExternalOperation(id: string): Promise<JiraIssueSummary | null> {
  // Teams claim-first delivery coexists on the same EXTERNAL_OPERATION table.
  // Dispatch by provider before acquiring the Jira lease — Teams has its own
  // processor (ExternalOperation row + advisory lock + AMBIGUOUS semantics).
  const providerProbe = await prisma.externalOperation.findUnique({
    where: { id },
    select: { provider: true },
  });
  if ((providerProbe?.provider as string) === 'MICROSOFT_TEAMS') {
    const { processMicrosoftTeamsOperation } = await import('./microsoft-teams/delivery');
    const teamsResult = (await processMicrosoftTeamsOperation(id)) as unknown as JiraIssueSummary | null;
    return teamsResult;
  }

  const claim = await claimOperation(id);
  if (!claim) {
    const complete = await prisma.externalOperation.findUnique({ where: { id } });
    return complete?.status === 'COMPLETED' && complete.externalKey
      ? {
          id: complete.externalId || complete.externalKey,
          key: complete.externalKey,
          url: String((complete.resultPayload as Record<string, unknown> | null)?.url || ''),
          status: String((complete.resultPayload as Record<string, unknown> | null)?.status || ''),
        }
      : null;
  }

  const { operation, leaseToken } = claim;
  if (operation.operation === 'ADD_COMMENT') {
    const value = operation.requestPayload;
    if (!value || Array.isArray(value) || typeof value !== 'object')
      throw new Error('Jira comment payload is missing');
    const input = value as Record<string, Prisma.JsonValue>;
    if (typeof input.externalKey !== 'string' || typeof input.comment !== 'string')
      throw new Error('Jira comment payload is invalid');
    const marker = `opsknight-comment-${operation.id}`;

    try {
      // Admission is workspace-scoped because Atlassian auth/rate/outage state
      // is shared by all issues in the configured Jira workspace.
      await assertProviderAdmitted(JIRA_PROVIDER_KEY);

      const outcome = await prisma.$transaction(async tx => {
        await acquireJiraWorkspaceProviderFence(tx);

        try {
          if (!(await hasJiraCommentMarker(input.externalKey as string, marker))) {
            await addJiraComment(input.externalKey as string, `${input.comment}\n\n[${marker}]`);
          }
        } catch (error) {
          const failure = jiraProviderFailureOptions(error);
          if (failure) await recordProviderFailure(JIRA_PROVIDER_KEY, failure);
          await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: operationFailureStatus(operation.attempts),
              nextAttemptAt: new Date(Date.now() + operationRetryDelayMs(error)),
              lastError: operationFailureMessage(error),
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          return { ok: false as const, error };
        }

        const completed = await tx.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'COMPLETED',
            resultPayload: { delivered: true },
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (completed.count !== 1) throw new Error('External operation lease was lost');

        await recordProviderSuccess(JIRA_PROVIDER_KEY);
        return { ok: true as const };
      }, providerFenceTransactionOptions);

      if (!outcome.ok) throw outcome.error;
      return null;
    } catch (error) {
      // Pre-I/O control-plane errors must not poison provider health. Release
      // the operation lease so the durable queue can retry after admission or
      // lifecycle state recovers.
      await releaseFailedOperation(id, leaseToken, operation.attempts, error);
      throw error;
    }
  }

  const input = parseJiraCreatePayload(operation.requestPayload);
  const marker = `opsknight-operation-${operation.id}`;
  try {
    await assertProviderAdmitted(JIRA_PROVIDER_KEY);

    const outcome = await prisma.$transaction(async tx => {
      await acquireJiraWorkspaceProviderFence(tx);

      if (input.actionItemId) {
        // Serialize Create Jira with Link Existing for this exact action item.
        await acquireJiraActionItemLinkFence(tx, input.actionItemId);

        const existingLink = await tx.externalIssueLink.findFirst({
          where: { provider: 'JIRA', actionItemId: input.actionItemId },
          select: { externalKey: true },
        });
        if (existingLink) {
          const failed = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'FAILED',
              lastError: `Action item is already linked to Jira issue ${existingLink.externalKey}.`,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (failed.count !== 1) throw new Error('External operation lease was lost');
          return { kind: 'already-linked' as const, externalKey: existingLink.externalKey };
        }
      }

      let issue: JiraIssueSummary;
      try {
        // Reconcile first on every retry. If Jira accepted an earlier request
        // but the response or DB commit was lost, adopt that issue instead of
        // creating a duplicate.
        issue =
          (await findJiraIssueByCorrelationLabel(marker)) ||
          (await createJiraIssue({
            ...input,
            labels: Array.from(new Set([...(input.labels || []), marker])),
          }));
      } catch (error) {
        const failure = jiraProviderFailureOptions(error);
        if (failure) await recordProviderFailure(JIRA_PROVIDER_KEY, failure);
        throw error;
      }

      await acquireJiraExternalIssueLinkFence(tx, 'JIRA', issue.key);
      const existingIssueLink = await tx.externalIssueLink.findFirst({
        where: {
          provider: 'JIRA',
          OR: [{ externalId: issue.id }, { externalKey: issue.key }],
        },
        select: { id: true, incidentId: true, actionItemId: true, externalKey: true },
      });

      const sameOwner =
        existingIssueLink &&
        existingIssueLink.incidentId === (input.incidentId ?? null) &&
        existingIssueLink.actionItemId === (input.actionItemId ?? null);

      if (existingIssueLink && !sameOwner) {
        const failed = await tx.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'FAILED',
            lastError: `Jira issue ${existingIssueLink.externalKey} is already owned by another OpsKnight entity.`,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (failed.count !== 1) throw new Error('External operation lease was lost');
        return { kind: 'ownership-conflict' as const, externalKey: existingIssueLink.externalKey };
      }

      if (existingIssueLink) {
        await tx.externalIssueLink.update({
          where: { id: existingIssueLink.id },
          data: {
            externalKey: issue.key,
            externalUrl: issue.url,
            externalStatus: issue.status ?? null,
            externalAssignee: issue.assignee ?? null,
            syncState: 'SYNCED',
            lastSyncedAt: new Date(),
          },
        });
      } else {
        await tx.externalIssueLink.create({
          data: {
            provider: 'JIRA',
            incidentId: input.incidentId ?? null,
            actionItemId: input.actionItemId ?? null,
            externalId: issue.id,
            externalKey: issue.key,
            externalUrl: issue.url,
            externalStatus: issue.status ?? null,
            externalAssignee: issue.assignee ?? null,
            syncState: 'SYNCED',
            lastSyncedAt: new Date(),
          },
        });
      }

      const completed = await tx.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'COMPLETED',
          externalId: issue.id,
          externalKey: issue.key,
          resultPayload: issue as Prisma.InputJsonObject,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (completed.count !== 1) throw new Error('External operation lease was lost');

      await recordProviderSuccess(JIRA_PROVIDER_KEY);
      return { kind: 'completed' as const, issue };
    }, providerFenceTransactionOptions);

    if (outcome.kind === 'already-linked') {
      throw new TerminalJiraOperationError(
        `This action item is already linked to Jira issue ${outcome.externalKey}. Refresh the page to see the current link.`
      );
    }
    if (outcome.kind === 'ownership-conflict') {
      throw new TerminalJiraOperationError(
        `Jira issue ${outcome.externalKey} is already linked to another OpsKnight entity.`
      );
    }

    return outcome.issue;
  } catch (error) {
    if (error instanceof TerminalJiraOperationError) throw error;

    await releaseFailedOperation(id, leaseToken, operation.attempts, error);
    throw error;
  }
}
