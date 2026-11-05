import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { withMcpDatabase } from '@/lib/database-workload';
import { runSerializableTransaction } from '@/lib/db-utils';
import { resolveMcpGrant } from '../auth/principal';
import { McpBoundaryError, requireMcp } from '../core/errors';
import {
  callApprovedMcpOperation,
  callMcpOperation,
  type ExecutionContext,
} from '../core/execution';

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
export const TASK_TTL_MS = 24 * 3600_000;
export const TASK_POLL_INTERVAL_MS = 5_000;
/** A human review takes minutes, not seconds: an approval task asks for the initial backoff. */
export const APPROVAL_TASK_POLL_INTERVAL_MS = 30_000;
/**
 * How long an approval task stays readable past the approval's own review deadline, so a decision
 * made at the last moment, or the lapse itself, is still delivered as the task's result.
 */
export const APPROVAL_TASK_GRACE_MS = 15 * 60_000;
/**
 * Tools whose wait is durable and asynchronous, so a task handle is meaningful: a runbook run,
 * and a human review of an approval (the long wait). The prepare tools stay synchronous so the
 * review link and ids reach the model at once.
 */
export const TASK_CAPABLE_TOOLS = new Set([
  'runbook_execute_approved',
  'operation_get_approval',
  'runbook_get_approval',
]);

/** What a task observes, by the tool that created it; status is always re-read from it. */
const TASK_KINDS = new Map([
  ['runbook_execute_approved', 'RUNBOOK_EXECUTION'],
  ['operation_get_approval', 'OPERATION_APPROVAL'],
  ['runbook_get_approval', 'RUNBOOK_APPROVAL'],
]);
const APPROVAL_KINDS = new Set(['OPERATION_APPROVAL', 'RUNBOOK_APPROVAL']);

const taskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

/** Per-request negotiation: a task may be returned only if this request declares the extension. */
export function clientSupportsTasks(params: unknown) {
  const meta = (params as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const capabilities = meta?.['io.modelcontextprotocol/clientCapabilities'] as
    { extensions?: Record<string, unknown> } | undefined;
  // eslint-disable-next-line security/detect-object-injection -- constant extension identifier
  const extension = capabilities?.extensions?.[TASKS_EXTENSION];
  return Boolean(extension && typeof extension === 'object');
}

export type TaskStatus = 'working' | 'input_required' | 'completed' | 'cancelled' | 'failed';
type ExecutionView = { id?: string; status?: string; [key: string]: unknown };

// Runbook failures are tool-level outcomes (completed + isError), never JSON-RPC task failures.
function mapStatus(execution: ExecutionView): { status: TaskStatus; message: string } {
  switch (execution.status) {
    case 'SUCCEEDED':
      return { status: 'completed', message: 'The runbook execution succeeded.' };
    case 'FAILED':
    case 'TIMED_OUT':
      return { status: 'completed', message: `The runbook execution ended ${execution.status}.` };
    case 'CANCELLED':
      return { status: 'cancelled', message: 'The runbook execution was cancelled.' };
    case 'CANCEL_REQUESTED':
      return { status: 'working', message: 'Cancellation requested; waiting for the runner.' };
    case 'WAITING_APPROVAL':
      return {
        status: 'working',
        message: 'Waiting for a native step approval in OpsKnight (not client input).',
      };
    default:
      return {
        status: 'working',
        message: `The runbook execution is ${execution.status ?? 'running'}.`,
      };
  }
}

function taskShape(
  task: { id: string; kind: string; createdAt: Date; expiresAt: Date },
  status: TaskStatus,
  message: string,
  lastUpdatedAt: Date
) {
  return {
    taskId: task.id,
    status,
    statusMessage: message,
    createdAt: task.createdAt.toISOString(),
    lastUpdatedAt: lastUpdatedAt.toISOString(),
    ttlMs: task.expiresAt.getTime() - task.createdAt.getTime(),
    pollIntervalMs: APPROVAL_KINDS.has(task.kind)
      ? APPROVAL_TASK_POLL_INTERVAL_MS
      : TASK_POLL_INTERVAL_MS,
  };
}

/**
 * The task a task-capable tool result becomes, or null when it is not a wait worth a handle: a
 * started runbook execution, or an approval that is still PENDING. Any other result (an error,
 * a decided or expired approval) is returned synchronously as it was.
 */
export function taskTargetOf(
  toolName: string,
  structured: Record<string, unknown> | undefined
): { kind: string; resourceId: string; expiresAt?: Date } | null {
  const kind = TASK_KINDS.get(toolName);
  if (!kind || !structured) return null;
  if (kind === 'RUNBOOK_EXECUTION')
    return typeof structured.executionId === 'string'
      ? { kind, resourceId: structured.executionId }
      : null;
  const resourceId = kind === 'OPERATION_APPROVAL' ? structured.approvalId : structured.previewId;
  const expiresAt =
    typeof structured.expiresAt === 'string' ? new Date(structured.expiresAt) : undefined;
  return structured.status === 'PENDING' &&
    typeof resourceId === 'string' &&
    expiresAt &&
    Number.isFinite(expiresAt.getTime())
    ? { kind, resourceId, expiresAt }
    : null;
}

/** Durably records the task before the handle is returned, so tasks/get resolves immediately. */
export async function createMcpTask(
  context: ExecutionContext,
  actorId: string,
  toolName: string,
  target: { kind: string; resourceId: string; expiresAt?: Date }
) {
  requireMcp(context.credentialId, 'MCP_INVALID_TOKEN', 401);
  // One clock for both ends keeps the advertised TTL exact. An approval task ends a short grace
  // after the approval's review deadline: long enough to report a last-moment decision or the
  // lapse, never a day-long handle on a review that is already over.
  const now = new Date();
  const ttlEnd = now.getTime() + TASK_TTL_MS;
  const expiresAt = new Date(
    Math.min(
      ttlEnd,
      target.expiresAt ? target.expiresAt.getTime() + APPROVAL_TASK_GRACE_MS : ttlEnd
    )
  );
  const task = await withMcpDatabase(() =>
    prisma.mcpTask.create({
      data: {
        id: randomBytes(24).toString('base64url'),
        grantId: context.grantId,
        credentialId: context.credentialId!,
        actorId,
        toolName,
        kind: target.kind,
        resourceId: target.resourceId,
        createdAt: now,
        expiresAt,
      },
    })
  );
  const message = APPROVAL_KINDS.has(target.kind)
    ? APPROVAL_WAITING
    : 'The runbook execution has been queued.';
  return {
    resultType: 'task' as const,
    ...taskShape(task, 'working', message, task.createdAt),
  };
}

const APPROVAL_WAITING = 'Waiting for review in OpsKnight; not client input.';

// Unknown, expired and foreign task ids are indistinguishable.
async function ownedTask(context: ExecutionContext, raw: unknown) {
  const taskId = taskIdSchema.safeParse(raw);
  if (!taskId.success) throw new McpBoundaryError('MCP_TASK_NOT_FOUND', 404);
  const auth = await resolveMcpGrant(context.grantId, context.credentialId);
  const task = await prisma.mcpTask.findUnique({ where: { id: taskId.data } });
  requireMcp(
    task &&
      task.grantId === context.grantId &&
      task.actorId === auth.actor.id &&
      task.expiresAt > new Date(),
    'MCP_TASK_NOT_FOUND',
    404
  );
  return task;
}

type OwnedTask = Awaited<ReturnType<typeof ownedTask>>;

/** Lost read authority hides the task rather than revealing what it observes. */
function hideOnLostAccess(error: unknown): never {
  if (error instanceof McpBoundaryError && [403, 404].includes(error.status))
    throw new McpBoundaryError('MCP_TASK_NOT_FOUND', 404);
  throw error;
}

/**
 * An approval task, re-read through the same reader the get-approval tool uses, so each poll
 * re-authorizes exactly as the tool does. PENDING is working; any decision or lapse completes
 * the task with the tool's own result, which is a valid outcome and never a tool error. A task
 * the client cancelled has only stopped observing: the approval itself is untouched.
 */
async function getApprovalTask(context: ExecutionContext, task: OwnedTask) {
  let state: Record<string, unknown>;
  try {
    state =
      task.kind === 'OPERATION_APPROVAL'
        ? await (
            await import('../approvals/operation')
          ).getMcpOperationApproval(context, { approvalId: task.resourceId })
        : await (
            await import('../approvals/runbook')
          ).getMcpRunbookApproval(context, { previewId: task.resourceId });
  } catch (error) {
    hideOnLostAccess(error);
  }
  const now = new Date();
  if (task.cancelRequestedAt)
    return {
      resultType: 'complete' as const,
      ...taskShape(task, 'cancelled', 'No longer observed; the approval is unchanged.', now),
    };
  if (state.status === 'PENDING')
    return {
      resultType: 'complete' as const,
      ...taskShape(task, 'working', APPROVAL_WAITING, now),
    };
  return {
    resultType: 'complete' as const,
    ...taskShape(task, 'completed', `The approval is ${String(state.status)}.`, now),
    result: {
      content: [{ type: 'text', text: JSON.stringify(state) }],
      structuredContent: state,
      isError: false,
    },
  };
}

/** Re-authenticates and re-authorizes on every poll; status comes from the durable record. */
export function getMcpTask(context: ExecutionContext, taskId: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const task = await ownedTask(context, taskId);
      if (APPROVAL_KINDS.has(task.kind)) return getApprovalTask(context, task);
      let execution: ExecutionView;
      try {
        const read = await callMcpOperation(context, 'getRunbookExecution', {
          path: { id: task.resourceId },
        });
        execution = ((read.data as { data?: ExecutionView })?.data ?? {}) as ExecutionView;
      } catch (error) {
        hideOnLostAccess(error);
      }
      const { status, message } = mapStatus(execution);
      const updatedAt =
        typeof execution.updatedAt === 'string' ? new Date(execution.updatedAt) : new Date();
      const base = {
        resultType: 'complete' as const,
        ...taskShape(task, status, message, updatedAt),
      };
      if (status !== 'completed') return base;
      const failed = execution.status !== 'SUCCEEDED';
      return {
        ...base,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ executionId: execution.id, status: execution.status }),
            },
          ],
          structuredContent: { executionId: execution.id, status: execution.status },
          isError: failed,
        },
      };
    })
  );
}

/**
 * Cooperative cancellation of a runbook execution through the native cancel command. The binding
 * check runs inside the command's own transaction; a retry is a replay. An already-finished
 * execution stays finished.
 */
export function cancelMcpTask(context: ExecutionContext, taskId: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const task = await ownedTask(context, taskId);
      // Cancelling an approval wait only stops observing it. There is no requester withdraw
      // command, and a client must never be able to decide or withdraw a human review.
      if (APPROVAL_KINDS.has(task.kind)) {
        await prisma.mcpTask.updateMany({
          where: { id: task.id, cancelRequestedAt: null },
          data: { cancelRequestedAt: new Date() },
        });
        return { resultType: 'complete' as const };
      }
      try {
        await callApprovedMcpOperation(
          context,
          'cancelRunbookExecution',
          {
            path: { id: task.resourceId },
            body: { reason: 'Cancelled by the MCP client that started this task.' },
            idempotencyKey: `mcp-task-cancel-${task.id}`,
          },
          async (tx, auth) => {
            await tx.$queryRaw`SELECT id FROM "McpTask" WHERE id = ${task.id} FOR UPDATE`;
            const current = await tx.mcpTask.findUnique({ where: { id: task.id } });
            requireMcp(
              current &&
                current.grantId === context.grantId &&
                current.actorId === auth.actor.id &&
                current.resourceId === task.resourceId,
              'MCP_TASK_NOT_FOUND',
              404
            );
            await tx.mcpTask.update({
              where: { id: task.id },
              data: { cancelRequestedAt: current.cancelRequestedAt ?? new Date() },
            });
          }
        );
      } catch (error) {
        // A finished execution cannot be cancelled; the acknowledgement must not claim otherwise.
        if (!(error instanceof McpBoundaryError && error.code === 'MCP_DOMAIN_REJECTED'))
          throw error;
      }
      return { resultType: 'complete' as const };
    })
  );
}

/** No OpsKnight task ever asks the client for input, so there is never an outstanding request. */
export async function updateMcpTask(context: ExecutionContext, taskId: unknown) {
  await withMcpDatabase(() => ownedTask(context, taskId));
  return { resultType: 'complete' as const };
}

/** Bounded retention on the existing scheduler. */
export async function cleanupExpiredMcpTasks(now = new Date()) {
  const expired = await prisma.mcpTask.findMany({
    where: { expiresAt: { lt: now } },
    take: 500,
    orderBy: { expiresAt: 'asc' },
    select: { id: true },
  });
  return runSerializableTransaction(
    async tx =>
      (
        await tx.mcpTask.deleteMany({
          where: { id: { in: expired.map(task => task.id) }, expiresAt: { lt: now } },
        })
      ).count
  );
}
