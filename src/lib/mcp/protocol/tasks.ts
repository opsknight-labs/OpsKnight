import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
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
/** Tools whose work is durable and asynchronous, so a task handle is meaningful. */
export const TASK_CAPABLE_TOOLS = new Set(['runbook_execute_approved']);

const taskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

/** Per-request negotiation: a task may be returned only if this request declares the extension. */
export function clientSupportsTasks(params: unknown) {
  const meta = (params as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const capabilities = meta?.['io.modelcontextprotocol/clientCapabilities'] as
    { extensions?: Record<string, unknown> } | undefined;
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
  task: { id: string; createdAt: Date; expiresAt: Date },
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
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
  };
}

/** Durably records the task before the handle is returned, so tasks/get resolves immediately. */
export async function createRunbookExecutionTask(
  context: ExecutionContext,
  actorId: string,
  executionId: string
) {
  requireMcp(context.credentialId, 'MCP_INVALID_TOKEN', 401);
  // One clock for both ends keeps the advertised TTL exact.
  const now = new Date();
  const task = await withMcpDatabase(() =>
    prisma.mcpTask.create({
      data: {
        id: randomBytes(24).toString('base64url'),
        grantId: context.grantId,
        credentialId: context.credentialId!,
        actorId,
        toolName: 'runbook_execute_approved',
        kind: 'RUNBOOK_EXECUTION',
        resourceId: executionId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + TASK_TTL_MS),
      },
    })
  );
  return {
    resultType: 'task' as const,
    ...taskShape(task, 'working', 'The runbook execution has been queued.', task.createdAt),
  };
}

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

/** Re-authenticates and re-authorizes on every poll; status comes from the durable execution. */
export function getMcpTask(context: ExecutionContext, taskId: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const task = await ownedTask(context, taskId);
      let execution: ExecutionView;
      try {
        const read = await callMcpOperation(context, 'getRunbookExecution', {
          path: { id: task.resourceId },
        });
        execution = ((read.data as { data?: ExecutionView })?.data ?? {}) as ExecutionView;
      } catch (error) {
        // Lost read authority hides the task rather than revealing the execution.
        if (error instanceof McpBoundaryError && [403, 404].includes(error.status))
          throw new McpBoundaryError('MCP_TASK_NOT_FOUND', 404);
        throw error;
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
 * Cooperative cancellation through the native cancel command. The binding check runs inside the
 * command's own transaction; a retry is a replay. An already-finished execution stays finished.
 */
export function cancelMcpTask(context: ExecutionContext, taskId: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const task = await ownedTask(context, taskId);
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
