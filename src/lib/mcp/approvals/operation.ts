import 'server-only';
import { createHash } from 'node:crypto';
import type { McpOperationApproval, Prisma } from '@prisma/client';
import { z } from 'zod';
import { withMcpDatabase } from '@/lib/database-workload';
import { runSerializableTransaction } from '@/lib/db-utils';
import { encrypt, decrypt } from '@/lib/encryption';
import { executeIdempotentOperation } from '@/lib/idempotency';
import { authorize } from '@/lib/authorization-policy';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { enforceV2RateLimit } from '@/lib/api-v2/rate-limit';
import { logAudit } from '@/lib/audit';
import { MCP_OPERATION_MAP, isMcpApprovalGated } from '../catalog';
import { resolveMcpGrant } from '../auth/principal';
import { mcpOrigin } from '../auth/config';
import { McpBoundaryError, requireMcp } from '../core/errors';
import {
  callApprovedMcpOperation,
  hasOperationAuthority,
  validateOperationArgs,
  type ExecutionContext,
} from '../core/execution';
import { lockMcpMutationAuthority } from '../core/mutation-authority';
import { projectMcpData } from '../core/projection';

export const MCP_APPROVAL_TTL_MS = 15 * 60_000;
// An approved plan that was claimed but not confirmed may be retried for a bounded window only.
const EXECUTION_WINDOW_MS = 60 * 60_000;
const MAX_PENDING_PER_GRANT = 20;
const MAX_STORED_RESULT_BYTES = 16384;
const PLACEHOLDER_KEY = 'frozen-by-approval-0000';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const approvalId = z.string().cuid();
export const prepareOperationSchema = z
  .object({
    operationId: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,127}$/),
    args: z.record(z.string(), z.unknown()),
    idempotencyKey: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export const commitOperationSchema = z.object({ approvalId }).strict();
export const approvalStatusSchema = commitOperationSchema;

const frozenSchema = z
  .object({
    path: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: z.unknown().optional(),
    ifMatch: z.string().max(128).optional(),
  })
  .strict();
type Frozen = z.infer<typeof frozenSchema>;

export const operationReviewSummarySchema = z
  .object({
    operationId: z.string(),
    method: z.string(),
    path: z.string(),
    risk: z.string(),
    description: z.string(),
    targets: z.record(z.string(), z.string()),
    ifMatch: z.string().nullable(),
    changes: z.array(z.tuple([z.string(), z.string()])),
    truncated: z.boolean(),
  })
  .strict();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function operationFor(operationId: string) {
  const operation = MCP_OPERATION_MAP.get(operationId);
  requireMcp(operation && isMcpApprovalGated(operation), 'MCP_OPERATION_UNAVAILABLE', 403);
  return operation;
}

/** Binds the exact arguments, target revision and reviewed contract/route version. */
export function mcpOperationDigest(operationId: string, frozen: Frozen) {
  const operation = operationFor(operationId);
  return createHash('sha256')
    .update(
      canonicalJson({
        version: 1,
        operationId,
        method: operation.method,
        path: operation.path,
        contract: operation.contractSha256,
        route: operation.routeSha256,
        args: frozen,
      })
    )
    .digest('hex');
}

// Replays of one approval share one REST receipt, independent of token rotation.
export function mcpApprovalCommitKey(id: string) {
  return `mcp-approval-${id}`;
}

const secretKey = /secret|password|token|credential|authorization|api.?key|private.?key/i;
function flatten(value: unknown, path: string, out: [string, string][], depth = 0): void {
  if (out.length >= 80) return;
  if (depth > 6) {
    out.push([path, '[too deep]']);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) out.push([path, '[]']);
    value.slice(0, 40).forEach((item, index) => flatten(item, `${path}[${index}]`, out, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) out.push([path, '{}']);
    for (const [key, child] of entries)
      if (secretKey.test(key)) out.push([`${path}.${key}`, '[withheld]']);
      else flatten(child, path ? `${path}.${key}` : key, out, depth + 1);
    return;
  }
  const text =
    typeof value === 'string' ? String(projectMcpData(value)) : (JSON.stringify(value) ?? 'null');
  out.push([path || '(value)', text.length > 300 ? `${text.slice(0, 300)}…` : text]);
}

function reviewSummary(operationId: string, frozen: Frozen) {
  const operation = operationFor(operationId);
  const changes: [string, string][] = [];
  flatten(frozen.body, '', changes);
  return operationReviewSummarySchema.parse({
    operationId,
    method: operation.method.toUpperCase(),
    path: operation.path,
    risk: operation.risk,
    description: operation.operationId,
    targets: frozen.path ?? {},
    ifMatch: frozen.ifMatch ?? null,
    changes,
    truncated: changes.length >= 80,
  });
}

async function admit(context: ExecutionContext) {
  context.budget.consumeOperation();
  requireMcp(context.credentialId, 'MCP_INVALID_TOKEN', 401);
  const auth = await resolveMcpGrant(context.grantId, context.credentialId);
  auth.apiKey.scopes = auth.apiKey.scopes.filter(scope => context.tokenScopes.includes(scope));
  auth.actor.apiKey = { id: auth.apiKey.id, scopes: auth.apiKey.scopes };
  await enforceV2RateLimit(auth.apiKey.id, 'WRITE');
  return auth;
}

async function lockApproval(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "McpOperationApproval" WHERE id = ${id} FOR UPDATE`;
  return tx.mcpOperationApproval.findUnique({ where: { id } });
}

/** A different, currently authorized human must be able to perform the same operation. */
async function assertOperationReviewer(
  tx: Prisma.TransactionClient,
  approval: McpOperationApproval,
  reviewer: { id: string; tokenVersion: number }
) {
  const operation = operationFor(approval.operationId);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${reviewer.id} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TeamMember" WHERE "userId" = ${reviewer.id} ORDER BY id FOR SHARE`;
  const user = await tx.user.findUnique({
    where: { id: reviewer.id },
    select: {
      id: true,
      role: true,
      status: true,
      tokenVersion: true,
      teamMemberships: { select: { teamId: true } },
    },
  });
  requireMcp(
    user?.status === 'ACTIVE' && user.tokenVersion === reviewer.tokenVersion,
    'MCP_REVIEWER_CHANGED',
    403
  );
  const actor = authorizationActorFromUser(user);
  requireMcp(actor && actor.id !== approval.actorId, 'MCP_DISTINCT_REVIEWER_REQUIRED', 403);
  // Several actions are allowed without a resource (resource checks happen later), so a
  // resource-less authorize() is not enough for a sensitive R2 change: require an administrator.
  requireMcp(
    actor.role === 'ADMIN' &&
      operation.authorizationActions.length > 0 &&
      operation.authorizationActions.every(action => authorize({ actor, action }).allowed),
    'MCP_REVIEWER_NOT_AUTHORIZED',
    403
  );
}

export function prepareMcpOperation(context: ExecutionContext, raw: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const input = prepareOperationSchema.parse(raw);
      const operation = operationFor(input.operationId);
      requireMcp(!('idempotencyKey' in input.args), 'MCP_INVALID_ARGUMENTS');
      // The commit derives its own durable key; the caller's args describe only the change.
      const validated = validateOperationArgs(
        input.operationId,
        { ...input.args, idempotencyKey: PLACEHOLDER_KEY },
        true
      );
      const frozen = frozenSchema.parse({
        path: validated.path,
        query: validated.query,
        body: validated.body,
        ifMatch: validated.ifMatch,
      });
      const digest = mcpOperationDigest(input.operationId, frozen);
      const initial = await admit(context);
      requireMcp(hasOperationAuthority(initial.actor, operation), 'MCP_OPERATION_FORBIDDEN', 403);
      const result = await runSerializableTransaction(async tx => {
        context.budget.check();
        const auth = await lockMcpMutationAuthority(
          tx,
          context,
          operation.requiredScopes,
          operation.authorizationActions,
          initial.actor
        );
        return executeIdempotentOperation(tx, {
          scope: 'mcp:operation:prepare',
          context: { key: input.idempotencyKey, principalId: auth.apiKey.id },
          payload: { operationId: input.operationId, digest },
          execute: async () => {
            const pending = await tx.mcpOperationApproval.count({
              where: {
                requesterGrantId: context.grantId,
                status: { in: ['PENDING', 'APPROVED', 'EXECUTING'] },
                expiresAt: { gt: new Date() },
              },
            });
            requireMcp(pending < MAX_PENDING_PER_GRANT, 'MCP_APPROVAL_BACKLOG', 429);
            const summary = reviewSummary(input.operationId, frozen);
            const approval = await tx.mcpOperationApproval.create({
              data: {
                operationId: input.operationId,
                riskClass: operation.risk,
                operationDigest: digest,
                contractDigest: operation.contractSha256,
                actorId: auth.actor.id,
                requesterGrantId: context.grantId,
                requesterCredentialId: context.credentialId!,
                envelope: await encrypt(JSON.stringify(frozen)),
                summary,
                expiresAt: new Date(Date.now() + MCP_APPROVAL_TTL_MS),
              },
            });
            await logAudit(
              {
                source: 'API',
                action: 'mcp.operation.prepared',
                entityType: 'SYSTEM_CONFIG',
                entityId: approval.id,
                actorId: auth.actor.id,
                details: {
                  operationId: input.operationId,
                  operationDigest: digest,
                  grantId: context.grantId,
                },
              },
              tx
            );
            return {
              approvalId: approval.id,
              operationDigest: digest,
              status: 'REQUIRES_NATIVE_APPROVAL',
              expiresAt: approval.expiresAt.toISOString(),
              reviewUrl: `${mcpOrigin()}/settings/integrations/mcp/approvals/operations/${approval.id}`,
              summary,
              warnings: [
                'Nothing has been changed. A different authorized human must approve this exact change in the native OpsKnight UI. Approval permits one execution and current permissions are checked again.',
              ],
            };
          },
        });
      });
      context.budget.consumeResult(result.value);
      return result.value;
    })
  );
}

function publicState(approval: McpOperationApproval) {
  const expired =
    approval.status === 'PENDING' || approval.status === 'APPROVED'
      ? approval.expiresAt <= new Date()
      : false;
  return {
    approvalId: approval.id,
    operationId: approval.operationId,
    operationDigest: approval.operationDigest,
    status: expired ? 'EXPIRED' : approval.status,
    expiresAt: approval.expiresAt.toISOString(),
    reviewedAt: approval.reviewedAt?.toISOString() ?? null,
    rejectedAt: approval.rejectedAt?.toISOString() ?? null,
    committedAt: approval.committedAt?.toISOString() ?? null,
    outcome: approval.outcome,
  };
}

export function getMcpOperationApproval(context: ExecutionContext, raw: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const input = approvalStatusSchema.parse(raw);
      const auth = await admit(context);
      // Status belongs to the requesting grant; an approval id is not a bearer capability.
      const approval = await runSerializableTransaction(tx =>
        tx.mcpOperationApproval.findUnique({ where: { id: input.approvalId } })
      );
      requireMcp(
        approval &&
          approval.requesterGrantId === context.grantId &&
          approval.actorId === auth.actor.id,
        'MCP_APPROVAL_UNAVAILABLE',
        404
      );
      const result = publicState(approval);
      context.budget.consumeResult(result);
      return result;
    })
  );
}

function storableResult(data: unknown) {
  const text = JSON.stringify(data ?? null);
  return Buffer.byteLength(text) <= MAX_STORED_RESULT_BYTES ? (data ?? null) : null;
}

export function commitApprovedMcpOperation(context: ExecutionContext, raw: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const input = commitOperationSchema.parse(raw);
      const initial = await admit(context);
      type Claim =
        | { done: McpOperationApproval; approval?: undefined; frozen?: undefined }
        | { done?: undefined; approval: McpOperationApproval; frozen: Frozen };
      const claim: Claim = await runSerializableTransaction(async (tx): Promise<Claim> => {
        context.budget.check();
        const approval = await lockApproval(tx, input.approvalId);
        requireMcp(
          approval &&
            approval.requesterGrantId === context.grantId &&
            approval.actorId === initial.actor.id,
          'MCP_APPROVAL_UNAVAILABLE',
          404
        );
        if (approval.status === 'COMMITTED' || approval.status === 'FAILED')
          return { done: approval };
        requireMcp(approval.status !== 'REJECTED', 'MCP_APPROVAL_REJECTED', 403);
        requireMcp(approval.status !== 'PENDING', 'MCP_APPROVAL_REQUIRED', 403);
        const now = Date.now();
        if (approval.status === 'APPROVED')
          requireMcp(approval.expiresAt.getTime() > now, 'MCP_APPROVAL_EXPIRED', 409);
        else
          requireMcp(
            approval.executingAt && approval.executingAt.getTime() + EXECUTION_WINDOW_MS > now,
            'MCP_APPROVAL_EXPIRED',
            409
          );
        requireMcp(
          approval.envelope && approval.reviewedById && approval.reviewerTokenVersion !== null,
          'MCP_APPROVAL_UNAVAILABLE',
          409
        );
        const operation = operationFor(approval.operationId);
        const frozen = frozenSchema.parse(JSON.parse(await decrypt(approval.envelope)));
        requireMcp(
          approval.contractDigest === operation.contractSha256 &&
            mcpOperationDigest(approval.operationId, frozen) === approval.operationDigest,
          'MCP_APPROVAL_PLAN_CHANGED',
          409
        );
        await assertOperationReviewer(tx, approval, {
          id: approval.reviewedById,
          tokenVersion: approval.reviewerTokenVersion,
        });
        if (approval.status === 'APPROVED')
          await tx.mcpOperationApproval.update({
            where: { id: approval.id },
            data: { status: 'EXECUTING', executingAt: new Date() },
          });
        return { approval, frozen };
      });
      if (claim.done) {
        const replay = { ...publicState(claim.done), replayed: true };
        context.budget.consumeResult(replay);
        return replay;
      }
      const { approval, frozen } = claim;
      try {
        const executed = await callApprovedMcpOperation(
          context,
          approval.operationId,
          { ...frozen, idempotencyKey: mcpApprovalCommitKey(approval.id) },
          async (tx, auth) => {
            // Same transaction as the effect: authority and review are rechecked before it.
            const current = await lockApproval(tx, approval.id);
            requireMcp(
              current &&
                current.status === 'EXECUTING' &&
                current.operationDigest === approval.operationDigest &&
                current.requesterGrantId === context.grantId &&
                current.actorId === auth.actor.id &&
                current.reviewedById &&
                current.reviewerTokenVersion !== null,
              'MCP_APPROVAL_UNAVAILABLE',
              409
            );
            await assertOperationReviewer(tx, current, {
              id: current.reviewedById,
              tokenVersion: current.reviewerTokenVersion,
            });
          }
        );
        const committed = await runSerializableTransaction(async tx => {
          const current = await lockApproval(tx, approval.id);
          if (current && ['EXECUTING', 'FAILED'].includes(current.status)) {
            const updated = await tx.mcpOperationApproval.update({
              where: { id: approval.id },
              data: {
                status: 'COMMITTED',
                committedAt: new Date(),
                envelope: null,
                outcome: {
                  ok: true,
                  requestId: executed.evidence.requestId,
                  etag: executed.evidence.etag,
                  result: storableResult(executed.data),
                } as Prisma.InputJsonValue,
              },
            });
            await logAudit(
              {
                source: 'API',
                action: 'mcp.operation.committed',
                entityType: 'SYSTEM_CONFIG',
                entityId: approval.id,
                actorId: initial.actor.id,
                details: {
                  operationId: approval.operationId,
                  operationDigest: approval.operationDigest,
                  grantId: context.grantId,
                },
              },
              tx
            );
            return updated;
          }
          return current ?? approval;
        });
        const result = {
          ...publicState(committed),
          result: executed.data,
          evidence: executed.evidence,
        };
        context.budget.consumeResult(result);
        return result;
      } catch (error) {
        // Only definitive domain rejections end the approval; ambiguous outcomes stay retryable
        // under the same durable REST receipt.
        if (
          error instanceof McpBoundaryError &&
          error.code === 'MCP_DOMAIN_REJECTED' &&
          [400, 403, 404, 412, 422].includes(error.status)
        )
          await markApprovalFailed(approval.id, error.status);
        throw error;
      }
    })
  );
}

async function markApprovalFailed(id: string, status: number) {
  await runSerializableTransaction(async tx => {
    await tx.mcpOperationApproval.updateMany({
      where: { id, status: 'EXECUTING' },
      data: {
        status: 'FAILED',
        envelope: null,
        outcome: { ok: false, code: 'MCP_DOMAIN_REJECTED', httpStatus: status },
      },
    });
  });
}

/** Native page/action callers supply the authenticated session identity themselves. */
export async function loadMcpOperationReview(
  id: string,
  reviewer: { id: string; tokenVersion: number }
) {
  approvalId.parse(id);
  return runSerializableTransaction(async tx => {
    const approval = await lockApproval(tx, id);
    requireMcp(approval, 'MCP_APPROVAL_UNAVAILABLE', 404);
    await assertOperationReviewer(tx, approval, reviewer);
    return { approval, summary: operationReviewSummarySchema.parse(approval.summary) };
  });
}

export async function decideMcpOperationReview(
  raw: unknown,
  reviewer: { id: string; tokenVersion: number }
) {
  const input = z
    .object({
      id: approvalId,
      operationDigest: digestSchema,
      decision: z.enum(['approve', 'reject']),
    })
    .strict()
    .parse(raw);
  return runSerializableTransaction(async tx => {
    const approval = await lockApproval(tx, input.id);
    requireMcp(approval, 'MCP_APPROVAL_UNAVAILABLE', 404);
    requireMcp(
      approval.status === 'PENDING' && approval.expiresAt > new Date(),
      'MCP_APPROVAL_EXPIRED',
      409
    );
    requireMcp(
      approval.operationDigest === input.operationDigest,
      'MCP_APPROVAL_PLAN_CHANGED',
      409
    );
    await assertOperationReviewer(tx, approval, reviewer);
    const operation = operationFor(approval.operationId);
    // The requesting grant must still be able to perform the change at review time.
    await lockMcpMutationAuthority(
      tx,
      { grantId: approval.requesterGrantId, tokenScopes: operation.requiredScopes },
      operation.requiredScopes,
      operation.authorizationActions
    );
    const now = new Date();
    const changed = await tx.mcpOperationApproval.updateMany({
      where: { id: approval.id, status: 'PENDING', operationDigest: input.operationDigest },
      data:
        input.decision === 'approve'
          ? {
              status: 'APPROVED',
              reviewedById: reviewer.id,
              reviewerTokenVersion: reviewer.tokenVersion,
              reviewedAt: now,
            }
          : { status: 'REJECTED', rejectedAt: now, envelope: null },
    });
    requireMcp(changed.count === 1, 'MCP_APPROVAL_EXPIRED', 409);
    await logAudit(
      {
        source: 'UI',
        action: `mcp.operation.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
        entityType: 'SYSTEM_CONFIG',
        entityId: approval.id,
        actorId: reviewer.id,
        details: {
          operationId: approval.operationId,
          operationDigest: approval.operationDigest,
          requesterGrantId: approval.requesterGrantId,
        },
      },
      tx
    );
  });
}
