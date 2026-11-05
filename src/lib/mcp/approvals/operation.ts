import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type McpOperationApproval } from '@prisma/client';
import { z } from 'zod/v3';
import { withMcpDatabase } from '@/lib/database-workload';
import { runSerializableTransaction } from '@/lib/db-utils';
import { encrypt, decrypt } from '@/lib/encryption';
import { executeIdempotentOperation } from '@/lib/idempotency';
import { authorize } from '@/lib/authorization-policy';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { enforceV2RateLimit } from '@/lib/api-v2/rate-limit';
import { logAudit } from '@/lib/audit';
import { MCP_CATALOG, MCP_OPERATION_MAP, isMcpApprovalGated, isMcpExecutable } from '../catalog';
import { resolveMcpGrant } from '../auth/principal';
import { mcpOrigin } from '../auth/config';
import { McpBoundaryError, requireMcp } from '../core/errors';
import { isAuthenticationFresh } from '@/lib/auth-control/actor';
import {
  callApprovedMcpOperation,
  callMcpOperation,
  callPreviewMcpOperation,
  requireOperationAuthority,
  validateOperationArgs,
  type ExecutionContext,
} from '../core/execution';
import { lockMcpMutationAuthority } from '../core/mutation-authority';
import { isMcpCapabilityDisabled } from '../catalog/capabilities';
import { projectMcpData } from '../core/projection';
import {
  commitDeadline,
  mcpApprovalPollGuidance,
  readMcpApprovalTiming,
  reviewDeadline,
} from './timing';
import {
  notifyOperationReviewers,
  notifyRequesterOfDecision,
  resolveReviewerNotices,
} from './notify';
import { MAX_PENDING_PER_GRANT } from './policy';

// An approved plan that was claimed but not confirmed may be retried for a bounded window only.
const EXECUTION_WINDOW_MS = 60 * 60_000;
const MAX_STORED_RESULT_BYTES = 16384;
const PLACEHOLDER_KEY = 'frozen-by-approval-0000';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** Optional reviewer note shown to the requester and the assistant as untrusted text. */
export const decisionReasonSchema = z.string().trim().max(500).optional();
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

const diffRowSchema = z
  .object({
    field: z.string(),
    before: z.string().nullable(),
    // Null only for a list member the request drops.
    after: z.string().nullable(),
    // not_in_view: the read of the target does not carry this field, so nothing is guessed.
    // not_compared: a withheld, cut-short or too-deep value, which can never be shown as equal.
    // removed: a list member the target has and the request's replacement list does not.
    status: z.enum(['changed', 'unchanged', 'not_in_view', 'not_compared', 'removed']),
  })
  .strict();
export type OperationDiffRow = z.infer<typeof diffRowSchema>;

export const operationReviewSummarySchema = z
  .object({
    operationId: z.string(),
    method: z.string(),
    path: z.string(),
    risk: z.string(),
    description: z.string(),
    targets: z.record(z.string(), z.string()),
    ifMatch: z.string().nullable(),
    // Query inputs are part of the digest, so the reviewer must see them. Older rows have none.
    query: z.array(z.tuple([z.string(), z.string()])).default([]),
    changes: z.array(z.tuple([z.string(), z.string()])),
    truncated: z.boolean(),
    // R3 only: the reviewed target state, shown to the native reviewer and never to the agent.
    preview: z.string().nullable().default(null),
    // Display only, never digest input: each changed field against the target's state when the
    // request was prepared. Shown to the native reviewer, never to the agent. Older rows have none.
    diff: z.array(diffRowSchema).default([]),
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
function flatten(
  value: unknown,
  path: string,
  out: [string, string][],
  depth = 0,
  limit = 80
): void {
  if (out.length >= limit) return;
  if (depth > 6) {
    out.push([path, '[too deep]']);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) out.push([path, '[]']);
    value
      .slice(0, 40)
      .forEach((item, index) => flatten(item, `${path}[${index}]`, out, depth + 1, limit));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) out.push([path, '{}']);
    for (const [key, child] of entries)
      if (secretKey.test(key)) out.push([`${path}.${key}`, '[withheld]']);
      else flatten(child, path ? `${path}.${key}` : key, out, depth + 1, limit);
    return;
  }
  const text =
    typeof value === 'string' ? String(projectMcpData(value)) : (JSON.stringify(value) ?? 'null');
  out.push([path || '(value)', text.length > 300 ? `${text.slice(0, 300)}…` : text]);
}

/** What the native review screen shows; everything bound by the digest must appear here. */
export function reviewSummary(operationId: string, frozen: Frozen) {
  const operation = operationFor(operationId);
  const changes: [string, string][] = [];
  flatten(frozen.body, '', changes);
  return operationReviewSummarySchema.parse({
    operationId,
    method: operation.method.toUpperCase(),
    path: operation.path,
    risk: operation.risk,
    // Plain-language catalog summary for the reviewer; descriptive only, never digest input.
    description: operation.summary ?? operation.operationId,
    targets: frozen.path ?? {},
    ifMatch: frozen.ifMatch ?? null,
    query: Object.entries(frozen.query ?? {}).map(([name, value]): [string, string] => [
      name,
      String(value).slice(0, 300),
    ]),
    changes,
    truncated: changes.length >= 80,
  });
}

const MAX_DIFF_TEXT = 300;
const MAX_REMOVED_ROWS = 40;

/** A flattened value that stands in for the real one, so equality says nothing. */
function placeholderValue(text: string) {
  return (
    text === '[withheld]' ||
    text === '[too deep]' ||
    (text.length > MAX_DIFF_TEXT && text.endsWith('…'))
  );
}

function clip(text: string) {
  return text.length > MAX_DIFF_TEXT ? `${text.slice(0, MAX_DIFF_TEXT)}…` : text;
}

/** The members of a list or object at `field`, as "suffix: value" lines. */
function membersOf(current: readonly [string, string][], field: string) {
  return current
    .filter(([path]) => path.startsWith(`${field}.`) || path.startsWith(`${field}[`))
    .map(([path, value]) => `${path.slice(field.length)}: ${value}`);
}

/**
 * The changed fields lined up against the target's state before the change, flattened and
 * redacted exactly like the changes themselves. A field the read does not carry is reported as
 * not in view rather than guessed; a withheld or cut-short value is never called unchanged; and a
 * list the request replaces with a shorter one lists the members it drops.
 */
export function reviewDiff(changes: readonly [string, string][], before: unknown) {
  if (before === null || before === undefined || !changes.length) return [];
  const current: [string, string][] = [];
  flatten(before, '', current, 0, 1000);
  const values = new Map(current);
  const rows = changes.map(([field, after]): OperationDiffRow => {
    const previous = values.get(field);
    if (previous === undefined) {
      // The request sets a whole list or object (an empty one, say) the target holds members of.
      const members = membersOf(current, field);
      return members.length
        ? { field, before: clip(members.join('\n')), after, status: 'changed' }
        : { field, before: null, after, status: 'not_in_view' };
    }
    if (placeholderValue(previous) || placeholderValue(after))
      return { field, before: previous, after, status: 'not_compared' };
    return { field, before: previous, after, status: previous === after ? 'unchanged' : 'changed' };
  });
  // A cut-short request may not show every member it sends, so nothing is called dropped.
  if (changes.length >= 80) return rows;
  // Every list the request names, with the member indexes it sends.
  const sent = new Map<string, Set<string>>();
  for (const [field] of changes)
    for (const match of field.matchAll(/\[(\d+)\]/g)) {
      const list = field.slice(0, match.index);
      const indexes = sent.get(list) ?? new Set<string>();
      indexes.add(match[1]);
      sent.set(list, indexes);
    }
  const removed: OperationDiffRow[] = [];
  for (const [list, indexes] of sent) {
    const dropped = new Set<string>();
    for (const [path] of current) {
      if (!path.startsWith(`${list}[`)) continue;
      const index = /^\[(\d+)\]/.exec(path.slice(list.length))?.[1];
      if (index !== undefined && !indexes.has(index)) dropped.add(index);
    }
    for (const index of dropped) {
      if (removed.length >= MAX_REMOVED_ROWS) break;
      const field = `${list}[${index}]`;
      const previous = values.get(field) ?? clip(membersOf(current, field).join('\n'));
      removed.push({ field, before: previous, after: null, status: 'removed' });
    }
  }
  return [...rows, ...removed];
}

const MAX_PREVIEW_CHARS = 4000;
type Operation = ReturnType<typeof operationFor>;

function isDestructive(operation: Operation) {
  return operation.risk === 'R3';
}

/** The preview read addresses the same target: its path parameters come from the frozen path. */
function previewArgs(operation: Operation, frozen: Frozen) {
  const preview = MCP_OPERATION_MAP.get(operation.impactPreview!)!;
  const names = [...preview.path.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
  const frozenPath = new Map(Object.entries(frozen.path ?? {}));
  return {
    path: Object.fromEntries(names.map(name => [name, frozenPath.get(name) ?? ''])),
  };
}

/** Reads the target for review; null when it is unavailable to this principal. */
async function readPreview(context: ExecutionContext, operation: Operation, frozen: Frozen) {
  try {
    const read = await callPreviewMcpOperation(
      context,
      operation.impactPreview!,
      previewArgs(operation, frozen)
    );
    return ((read.data as { data?: unknown })?.data ?? null) as unknown;
  } catch (error) {
    if (error instanceof McpBoundaryError && [403, 404].includes(error.status)) return null;
    throw error;
  }
}

const beforeReads = new Map<string, string | null>();
/**
 * The plain read of the same target an update or replace (R2, no impact preview) can be shown
 * against: a reviewed R0 GET at exactly the same path. Null when there is none.
 */
export function beforeReadFor(operation: Operation): string | null {
  if (operation.impactPreview || !['patch', 'put'].includes(operation.method)) return null;
  const cached = beforeReads.get(operation.operationId);
  if (cached !== undefined) return cached;
  const read =
    MCP_CATALOG.find(
      candidate =>
        candidate.method === 'get' &&
        candidate.path === operation.path &&
        candidate.risk === 'R0' &&
        isMcpExecutable(candidate)
    )?.operationId ?? null;
  beforeReads.set(operation.operationId, read);
  return read;
}

/**
 * Best effort, for the reviewer's before/after view only: the target read under the requester's
 * own permissions. Any failure shows no "before" and never blocks or binds the request.
 */
async function readBefore(context: ExecutionContext, operation: Operation, frozen: Frozen) {
  const read = beforeReadFor(operation);
  if (!read) return null;
  try {
    const result = await callMcpOperation(context, read, { path: frozen.path ?? {} });
    return ((result.data as { data?: unknown })?.data ?? null) as unknown;
  } catch {
    return null;
  }
}

/** Version fields when the resource has them, so time-derived fields do not invalidate review. */
function previewDigestOf(data: unknown) {
  const object = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const versioned = ['updatedAt', 'revision', 'version'].filter(key => key in object);
  const fields = new Map(Object.entries(object));
  const basis = versioned.length
    ? Object.fromEntries(['id', ...versioned].map(key => [key, fields.get(key)]))
    : data;
  return createHash('sha256').update(canonicalJson(basis)).digest('hex');
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

/**
 * A currently authorized administrator must be able to perform the same operation; the requester
 * may review their own request only if they are an administrator.
 */
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
  requireMcp(actor, 'MCP_REVIEWER_CHANGED', 403);
  // An administrator may approve their own request; the decision itself demands an explicit
  // confirmation. Anyone else needs a second person.
  const selfReview = actor.id === approval.actorId;
  requireMcp(!selfReview || actor.role === 'ADMIN', 'MCP_DISTINCT_REVIEWER_REQUIRED', 403);
  // A request made with a personal access token always needs a second person: the token is a
  // long-lived secret that could be used by someone other than its owner.
  if (selfReview) {
    const requester = await tx.mcpGrant.findUnique({
      where: { id: approval.requesterGrantId },
      select: { kind: true },
    });
    requireMcp(requester?.kind !== 'PAT', 'MCP_DISTINCT_REVIEWER_REQUIRED', 403);
  }
  // Several actions are allowed without a resource (resource checks happen later), so a
  // resource-less authorize() is not enough for a sensitive R2 change: require an administrator.
  requireMcp(
    actor.role === 'ADMIN' &&
      operation.authorizationActions.length > 0 &&
      operation.authorizationActions.every(action => authorize({ actor, action }).allowed),
    'MCP_REVIEWER_NOT_AUTHORIZED',
    403
  );
  return { selfReview };
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
      requireOperationAuthority(initial.actor, operation);
      // A destructive change is reviewed against the target's current state.
      const preview = isDestructive(operation)
        ? await readPreview(context, operation, frozen)
        : null;
      if (isDestructive(operation)) requireMcp(preview, 'MCP_RESOURCE_UNAVAILABLE', 404);
      const before = isDestructive(operation)
        ? preview
        : await readBefore(context, operation, frozen);
      const result = await runSerializableTransaction(async tx => {
        context.budget.check();
        const auth = await lockMcpMutationAuthority(
          tx,
          context,
          operation.requiredScopes,
          operation.authorizationActions,
          initial.actor,
          [input.operationId, 'operation_prepare']
        );
        const prepared = await executeIdempotentOperation(tx, {
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
            const timing = await readMcpApprovalTiming(tx);
            const previewText = preview === null ? null : JSON.stringify(preview, null, 2);
            const reviewed = reviewSummary(input.operationId, frozen);
            const summary = {
              ...reviewed,
              diff: reviewDiff(reviewed.changes, before),
              preview:
                previewText && previewText.length > MAX_PREVIEW_CHARS
                  ? `${previewText.slice(0, MAX_PREVIEW_CHARS)}\n…`
                  : previewText,
            };
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
                previewDigest: preview === null ? null : previewDigestOf(preview),
                expiresAt: reviewDeadline(timing),
              },
            });
            // The before/after values are for the human reviewer only, like the preview.
            const { diff: _reviewerOnly, ...agentSummary } = summary;
            await notifyOperationReviewers(tx, {
              approvalId: approval.id,
              actorId: auth.actor.id,
              grantId: context.grantId,
              summary: summary.description,
              authorizationActions: operation.authorizationActions,
              expiresAt: approval.expiresAt,
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
              commitWindowMinutes: timing.commitWindowMinutes,
              // The captured target state is for the human reviewer only.
              summary: {
                ...agentSummary,
                preview: summary.preview === null ? null : '[shown to reviewer]',
              },
              warnings: [
                'Nothing has been changed. An OpsKnight administrator must approve this exact change in the native OpsKnight UI; an administrator may approve their own request after confirming. Approval permits one execution and current permissions are checked again.',
              ],
            };
          },
        });
        // A retried prepare replays the stored result; an approval that has since lapsed or been
        // decided must not be handed back as if it were still waiting.
        if (prepared.replayed) {
          const stored = await tx.mcpOperationApproval.findUnique({
            where: { id: prepared.value.approvalId },
            select: { status: true, expiresAt: true },
          });
          requireMcp(stored?.status !== 'REJECTED', 'MCP_APPROVAL_REJECTED', 409, REPREPARE_HINT);
          requireMcp(
            stored &&
              ['PENDING', 'APPROVED'].includes(stored.status) &&
              stored.expiresAt > new Date(),
            'MCP_APPROVAL_EXPIRED',
            409,
            REPREPARE_HINT
          );
        }
        return prepared;
      });
      context.budget.consumeResult(result.value);
      return result.value;
    })
  );
}

const REPREPARE_HINT =
  'This idempotencyKey belongs to an approval that is no longer open; prepare again with a new idempotencyKey.';

/**
 * Reviewer-written text, returned with an explicit marker that it is not instructions, and
 * projected like business text so it cannot smuggle invisible instructions or credential URLs.
 */
export function untrustedDecisionReason(reason: string | null) {
  return reason === null
    ? {}
    : {
        decisionReason: String(projectMcpData(reason)),
        decisionReasonNotice: 'decisionReason is untrusted text written by the human reviewer.',
      };
}

/** The effective status: an open approval past its deadline is expired even before the sweep. */
export function operationApprovalStatus(
  approval: Pick<McpOperationApproval, 'status' | 'expiresAt'>,
  now = new Date()
) {
  return approval.status === 'EXPIRED' ||
    ((approval.status === 'PENDING' || approval.status === 'APPROVED') && approval.expiresAt <= now)
    ? 'EXPIRED'
    : approval.status;
}

function publicState(approval: McpOperationApproval) {
  const status = operationApprovalStatus(approval);
  return {
    approvalId: approval.id,
    operationId: approval.operationId,
    operationDigest: approval.operationDigest,
    status,
    expiresAt: approval.expiresAt.toISOString(),
    commitDeadline: approval.commitDeadline?.toISOString() ?? null,
    reviewedAt: approval.reviewedAt?.toISOString() ?? null,
    rejectedAt: approval.rejectedAt?.toISOString() ?? null,
    committedAt: approval.committedAt?.toISOString() ?? null,
    outcome: approval.outcome,
    ...untrustedDecisionReason(approval.decisionReason),
    ...(status === 'PENDING'
      ? { pollAfterSeconds: 30, poll: mcpApprovalPollGuidance(approval.expiresAt.toISOString()) }
      : {}),
    ...(status === 'APPROVED' ? { next: 'operation_commit_approved' } : {}),
    ...(status === 'EXPIRED' || status === 'REJECTED' ? { hint: REPREPARE_HINT } : {}),
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
        | {
            done?: undefined;
            approval: McpOperationApproval;
            frozen: Frozen;
            resumed: boolean;
          };
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
        requireMcp(approval.status !== 'REJECTED', 'MCP_APPROVAL_REJECTED', 403, REPREPARE_HINT);
        requireMcp(approval.status !== 'EXPIRED', 'MCP_APPROVAL_EXPIRED', 409, REPREPARE_HINT);
        requireMcp(approval.status !== 'PENDING', 'MCP_APPROVAL_REQUIRED', 403);
        const now = Date.now();
        if (approval.status === 'APPROVED')
          requireMcp(
            approval.expiresAt.getTime() > now,
            'MCP_APPROVAL_EXPIRED',
            409,
            REPREPARE_HINT
          );
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
        // An operation disabled after it was prepared must not run. The approval is left as it is,
        // so it can still be committed before it expires if an administrator re-enables it.
        await tx.$queryRaw`SELECT id FROM "McpPolicy" WHERE id = 'default' FOR SHARE`;
        const policy = await tx.mcpPolicy.findUnique({
          where: { id: 'default' },
          select: { disabledCapabilities: true },
        });
        requireMcp(
          !isMcpCapabilityDisabled(
            policy?.disabledCapabilities,
            approval.operationId,
            'operation_commit_approved'
          ),
          'MCP_CAPABILITY_DISABLED',
          403
        );
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
        if (approval.riskClass === 'R3')
          requireMcp(approval.reviewerAuthenticatedAt, 'MCP_REAUTHENTICATION_REQUIRED', 403);
        const resumed = approval.status === 'EXECUTING';
        if (!resumed)
          await tx.mcpOperationApproval.update({
            where: { id: approval.id },
            data: { status: 'EXECUTING', executingAt: new Date() },
          });
        return { approval, frozen, resumed };
      });
      if (claim.done) {
        const replay = { ...publicState(claim.done), replayed: true };
        context.budget.consumeResult(replay);
        return replay;
      }
      const { approval, frozen, resumed } = claim;
      const attemptId = randomUUID();
      const operation = operationFor(approval.operationId);
      const deletes = operation.method === 'delete';
      if (isDestructive(operation)) {
        const current = await readPreview(context, operation, frozen);
        if (current === null) {
          // Resuming an interrupted delete: an absent target is the observed outcome, not a failure.
          if (resumed && deletes)
            return finishCommit(context, approval, initial.actor.id, null, {
              postcondition: 'TARGET_ABSENT',
              reconciled: true,
            });
          await markApprovalFailed(approval.id, context.grantId, 404, 'MCP_RESOURCE_UNAVAILABLE');
          throw new McpBoundaryError('MCP_RESOURCE_UNAVAILABLE', 404);
        }
        // A fresh commit must act on exactly the reviewed target state.
        if (!resumed && previewDigestOf(current) !== approval.previewDigest) {
          await markApprovalFailed(approval.id, context.grantId, 409, 'MCP_APPROVAL_PLAN_CHANGED');
          throw new McpBoundaryError('MCP_APPROVAL_PLAN_CHANGED', 409);
        }
      }
      try {
        const executed = await callApprovedMcpOperation(
          context,
          approval.operationId,
          { ...frozen, idempotencyKey: mcpApprovalCommitKey(approval.id) },
          async (tx, auth, phase) => {
            // Same transaction as the effect: authority and review are rechecked before it.
            const current = await lockApproval(tx, approval.id);
            // Nested helpers may run the hook twice in one transaction; this attempt's mark is final.
            if (
              phase === 'mutation' &&
              current?.status === 'COMMITTED' &&
              attemptOf(current.outcome) === attemptId
            )
              return;
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
            // A stored-result lookup only checks; completion is recorded in the mutation itself.
            if (phase !== 'mutation') return;
            // Record completion in the effect's own transaction: both commit or neither does,
            // so a crash can never leave an applied change with an unfinished approval.
            await tx.mcpOperationApproval.update({
              where: { id: approval.id },
              data: {
                status: 'COMMITTED',
                committedAt: new Date(),
                envelope: null,
                outcome: { attempt: attemptId },
              },
            });
            await logAudit(
              {
                source: 'API',
                action: 'mcp.operation.committed',
                entityType: 'SYSTEM_CONFIG',
                entityId: approval.id,
                actorId: auth.actor.id,
                details: {
                  operationId: approval.operationId,
                  operationDigest: approval.operationDigest,
                  grantId: context.grantId,
                },
              },
              tx
            );
          }
        );
        // Verify the destructive effect is observable; record the truth either way.
        let postcondition: string | undefined;
        if (isDestructive(operation)) {
          try {
            const after = await readPreview(context, operation, frozen);
            postcondition = (deletes ? after === null : after !== null)
              ? 'VERIFIED'
              : 'NOT_VERIFIED';
          } catch {
            postcondition = 'UNKNOWN';
          }
        }
        return finishCommit(
          context,
          approval,
          initial.actor.id,
          executed,
          { ...(postcondition ? { postcondition } : {}) },
          attemptId
        );
      } catch (error) {
        // Only definitive domain rejections end the approval; ambiguous outcomes stay retryable
        // under the same durable REST receipt.
        const definitive =
          error instanceof McpBoundaryError &&
          error.code === 'MCP_DOMAIN_REJECTED' &&
          ([400, 403, 404, 412, 422].includes(error.status) ||
            (error.status === 409 && error.retryable === false));
        // A route can commit its transaction yet report failure; undo only this attempt's mark.
        if (error instanceof McpBoundaryError && error.code === 'MCP_DOMAIN_REJECTED')
          await revertAttempt(
            approval.id,
            attemptId,
            definitive ? 'FAILED' : 'EXECUTING',
            error.status
          );
        if (definitive) await markApprovalFailed(approval.id, context.grantId, error.status);
        throw error;
      }
    })
  );
}

const attemptOf = (outcome: unknown) =>
  outcome && typeof outcome === 'object' && 'attempt' in outcome
    ? (outcome as { attempt?: unknown }).attempt
    : undefined;

async function revertAttempt(
  id: string,
  attemptId: string,
  status: 'FAILED' | 'EXECUTING',
  httpStatus: number
) {
  await runSerializableTransaction(async tx => {
    const current = await lockApproval(tx, id);
    if (current?.status !== 'COMMITTED' || attemptOf(current.outcome) !== attemptId) return;
    await tx.mcpOperationApproval.update({
      where: { id },
      data: {
        status,
        committedAt: null,
        outcome:
          status === 'FAILED'
            ? { ok: false, code: 'MCP_DOMAIN_REJECTED', httpStatus }
            : Prisma.DbNull,
      },
    });
    await logAudit(
      {
        source: 'API',
        action: 'mcp.operation.reverted',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: current.actorId,
        details: { operationId: current.operationId, httpStatus, status },
      },
      tx
    );
  });
}

async function finishCommit(
  context: ExecutionContext,
  approval: McpOperationApproval,
  actorId: string,
  executed: { data: unknown; evidence: { requestId: string; etag: string | null } } | null,
  extra: Record<string, unknown>,
  attemptId?: string
) {
  const committed = await runSerializableTransaction(async tx => {
    const current = await lockApproval(tx, approval.id);
    // Already committed atomically with the effect: only the descriptive outcome remains.
    if (
      current?.status === 'COMMITTED' &&
      (current.outcome === null || (attemptId && attemptOf(current.outcome) === attemptId))
    )
      return tx.mcpOperationApproval.update({
        where: { id: approval.id },
        data: {
          outcome: {
            ok: true,
            requestId: executed?.evidence.requestId ?? null,
            etag: executed?.evidence.etag ?? null,
            result: executed ? storableResult(executed.data) : null,
            ...extra,
          } as Prisma.InputJsonValue,
        },
      });
    if (current && ['EXECUTING', 'FAILED'].includes(current.status)) {
      const updated = await tx.mcpOperationApproval.update({
        where: { id: approval.id },
        data: {
          status: 'COMMITTED',
          committedAt: new Date(),
          envelope: null,
          outcome: {
            ok: true,
            requestId: executed?.evidence.requestId ?? null,
            etag: executed?.evidence.etag ?? null,
            result: executed ? storableResult(executed.data) : null,
            ...extra,
          } as Prisma.InputJsonValue,
        },
      });
      await logAudit(
        {
          source: 'API',
          action: 'mcp.operation.committed',
          entityType: 'SYSTEM_CONFIG',
          entityId: approval.id,
          actorId,
          details: {
            operationId: approval.operationId,
            operationDigest: approval.operationDigest,
            grantId: context.grantId,
            ...extra,
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
    ...(executed ? { result: executed.data, evidence: executed.evidence } : {}),
  };
  context.budget.consumeResult(result);
  return result;
}

async function markApprovalFailed(
  id: string,
  grantId: string,
  status: number,
  code = 'MCP_DOMAIN_REJECTED'
) {
  await runSerializableTransaction(async tx => {
    // A durable REST receipt proves the effect committed; never record failure over it.
    const receipt = await tx.backgroundJob.count({
      where: {
        id: { startsWith: 'idem:', endsWith: `:mcp:${grantId}:${mcpApprovalCommitKey(id)}` },
      },
    });
    if (receipt) return;
    await tx.mcpOperationApproval.updateMany({
      where: { id, status: 'EXECUTING' },
      data: {
        status: 'FAILED',
        envelope: null,
        outcome: { ok: false, code, httpStatus: status },
      },
    });
  });
}

/**
 * The request as its own requester sees it: status only. Null for anyone else, who must go
 * through the reviewer checks instead.
 */
export async function loadMcpOperationRequest(id: string, viewerId: string) {
  approvalId.parse(id);
  const approval = await runSerializableTransaction(tx =>
    tx.mcpOperationApproval.findUnique({ where: { id } })
  );
  requireMcp(approval, 'MCP_APPROVAL_UNAVAILABLE', 404);
  return approval.actorId === viewerId ? approval : null;
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
    const { selfReview } = await assertOperationReviewer(tx, approval, reviewer);
    return {
      approval,
      selfReview,
      summary: operationReviewSummarySchema.parse(approval.summary),
      requiresFreshAuthentication: approval.riskClass === 'R3',
    };
  });
}

export async function decideMcpOperationReview(
  raw: unknown,
  reviewer: { id: string; tokenVersion: number; authenticatedAt?: number }
) {
  const input = z
    .object({
      id: approvalId,
      operationDigest: digestSchema,
      decision: z.enum(['approve', 'reject']),
      confirmSelfApproval: z.literal('yes').optional(),
      reason: decisionReasonSchema,
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
    const { selfReview } = await assertOperationReviewer(tx, approval, reviewer);
    requireMcp(
      !selfReview || input.decision === 'reject' || input.confirmSelfApproval === 'yes',
      'MCP_SELF_APPROVAL_CONFIRMATION_REQUIRED',
      400
    );
    const operation = operationFor(approval.operationId);
    // The requesting grant must still be able to perform the change at review time.
    await lockMcpMutationAuthority(
      tx,
      { grantId: approval.requesterGrantId, tokenScopes: operation.requiredScopes },
      operation.requiredScopes,
      operation.authorizationActions
    );
    // Approving a destructive change needs a recent sign-in (the product step-up window).
    const destructive = approval.riskClass === 'R3';
    if (destructive && input.decision === 'approve')
      requireMcp(
        isAuthenticationFresh(reviewer.authenticatedAt, 'admin'),
        'MCP_REAUTHENTICATION_REQUIRED',
        403
      );
    const now = new Date();
    const reason = input.reason || null;
    // Approval opens a fresh commit window (capped from the request), so a late approval still
    // leaves the assistant time to apply it. The deadline is the effective expiry from now on.
    const deadline =
      input.decision === 'approve'
        ? commitDeadline(await readMcpApprovalTiming(tx), approval.createdAt, now.getTime())
        : null;
    const changed = await tx.mcpOperationApproval.updateMany({
      where: { id: approval.id, status: 'PENDING', operationDigest: input.operationDigest },
      data:
        input.decision === 'approve'
          ? {
              status: 'APPROVED',
              reviewedById: reviewer.id,
              reviewerTokenVersion: reviewer.tokenVersion,
              reviewedAt: now,
              selfApproved: selfReview,
              decisionReason: String(projectMcpData(reason)),
              commitDeadline: deadline,
              expiresAt: deadline!,
              ...(destructive
                ? { reviewerAuthenticatedAt: new Date(reviewer.authenticatedAt!) }
                : {}),
            }
          : {
              status: 'REJECTED',
              rejectedAt: now,
              rejectedById: reviewer.id,
              decisionReason: String(projectMcpData(reason)),
              envelope: null,
            },
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
          selfApproved: selfReview && input.decision === 'approve',
          ...(reason ? { reason } : {}),
          ...(deadline ? { commitDeadline: deadline.toISOString() } : {}),
        },
      },
      tx
    );
    await resolveReviewerNotices(tx, [approval.id], input.decision, now, reviewer.id);
    await notifyRequesterOfDecision(tx, {
      id: approval.id,
      requesterId: approval.actorId,
      reviewerId: reviewer.id,
      kind: 'operation',
      decision: input.decision,
      commitDeadline: deadline,
    });
  });
}
