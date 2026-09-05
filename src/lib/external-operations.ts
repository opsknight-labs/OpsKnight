import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  createJiraIssue,
  findJiraIssueByCorrelationLabel,
  type JiraIssueSummary,
  addJiraComment,
  hasJiraCommentMarker,
} from '@/lib/jira';
import {
  assertProviderAdmitted,
  recordProviderFailure,
  recordProviderSuccess,
} from '@/lib/provider-admission';

const LEASE_MS = 5 * 60_000;

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

function jiraCreateKey(input: JiraCreateOperationInput): string {
  const owner = input.incidentId
    ? `incident:${input.incidentId}`
    : input.actionItemId
      ? `action-item:${input.actionItemId}`
      : `request:${crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
  return `jira:create:${owner}`;
}

export async function enqueueJiraCommentOperations(
  inputs: JiraCommentOperationInput[]
): Promise<{ attempted: number; pending: number }> {
  let pending = 0;
  await prisma.$transaction(async tx => {
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
          maxAttempts: 8,
          payload: { operationId: operation.id },
        },
      });
      pending++;
    }
  });
  return { attempted: inputs.length, pending };
}

export async function enqueueJiraCreateOperation(input: JiraCreateOperationInput): Promise<string> {
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
        maxAttempts: 8,
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
  return value as unknown as JiraCreateOperationInput;
}

export async function processExternalOperation(id: string): Promise<JiraIssueSummary | null> {
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
    const providerKey = `jira:issue:${input.externalKey}`;
    const marker = `opsknight-comment-${operation.id}`;
    try {
      await assertProviderAdmitted(providerKey);
      if (!(await hasJiraCommentMarker(input.externalKey, marker))) {
        await addJiraComment(input.externalKey, `${input.comment}\n\n[${marker}]`);
      }
      const completed = await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'COMPLETED',
          resultPayload: { delivered: true },
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (completed.count !== 1) throw new Error('External operation lease was lost');
      await recordProviderSuccess(providerKey);
      return null;
    } catch (error) {
      await recordProviderFailure(providerKey);
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: operation.attempts >= 8 ? 'FAILED' : 'AMBIGUOUS',
          nextAttemptAt: new Date(Date.now() + 30_000),
          lastError:
            error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      throw error;
    }
  }

  const input = parseJiraCreatePayload(operation.requestPayload);
  const marker = `opsknight-operation-${operation.id}`;
  try {
    // Reconcile first on every retry. If Jira accepted an earlier request but
    // the response or DB commit was lost, this adopts that issue.
    const issue =
      (await findJiraIssueByCorrelationLabel(marker)) ||
      (await createJiraIssue({
        ...input,
        labels: Array.from(new Set([...(input.labels || []), marker])),
      }));

    await prisma.$transaction(async tx => {
      await tx.externalIssueLink.upsert({
        where: { provider_externalId: { provider: 'JIRA', externalId: issue.id } },
        create: {
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
        update: {
          incidentId: input.incidentId ?? undefined,
          actionItemId: input.actionItemId ?? undefined,
          externalKey: issue.key,
          externalUrl: issue.url,
          externalStatus: issue.status ?? null,
          externalAssignee: issue.assignee ?? null,
          syncState: 'SYNCED',
          lastSyncedAt: new Date(),
        },
      });
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
    });
    return issue;
  } catch (error) {
    await prisma.externalOperation.updateMany({
      where: { id, status: 'PROCESSING', leaseToken },
      data: {
        status: 'AMBIGUOUS',
        nextAttemptAt: new Date(Date.now() + 30_000),
        lastError:
          error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    throw error;
  }
}
