import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma, RunbookPreviewAuthorization } from '@prisma/client';
import { z } from 'zod/v3';
import { withMcpDatabase } from '@/lib/database-workload';
import { runSerializableTransaction } from '@/lib/db-utils';
import { encrypt, decrypt } from '@/lib/encryption';
import { executeIdempotentOperation } from '@/lib/idempotency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { RunbookExecuteV2Schema } from '@/lib/api-v2/validation';
import { resolveV2RunbookExecution } from '@/lib/api-v2/runbook-execution';
import { enforceV2RateLimit } from '@/lib/api-v2/rate-limit';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import { parseRunbookDefinition, flattenSteps } from '@/lib/runbooks/definition';
import { resolvedApprovalPlan } from '@/lib/runbooks/approval-plan';
import { assertPreviewReviewer, reviewRunbookPreview } from '@/lib/runbooks/preview-review';
import { logAudit } from '@/lib/audit';
import { resolveMcpGrant } from '../auth/principal';
import { mcpOrigin } from '../auth/config';
import { requireMcp } from '../core/errors';
import { lockMcpMutationAuthority } from '../core/mutation-authority';
import type { ExecutionContext } from '../core/execution';
import {
  MAX_PENDING_PER_GRANT,
  MCP_REVIEWED_RUNBOOK_SCOPES,
  canUseReviewedRunbooks,
} from './policy';
import {
  commitDeadline,
  mcpApprovalPollGuidance,
  readMcpApprovalTiming,
  reviewDeadline,
} from './timing';
import {
  notifyRequesterOfDecision,
  notifyRunbookReviewers,
  resolveReviewerNotices,
} from './notify';
import { decisionReasonSchema, untrustedDecisionReason } from './operation';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencyKey = z.string().trim().min(1).max(128);
export const prepareRunbookSchema = z
  .object({
    runbookId: z.string().cuid(),
    body: RunbookExecuteV2Schema.omit({ expectedPlanDigest: true }).strict(),
    idempotencyKey,
  })
  .strict();
export const executeApprovedRunbookSchema = z
  .object({ previewId: digest, idempotencyKey })
  .strict();
export const runbookApprovalStatusSchema = z.object({ previewId: digest }).strict();
const envelopeSchema = z
  .object({
    request: prepareRunbookSchema.omit({ idempotencyKey: true }),
    authorizationToken: digest,
  })
  .strict();
export const runbookReviewSummarySchema = z
  .object({
    runbookId: z.string().cuid(),
    versionId: z.string().cuid(),
    version: z.number(),
    checksum: digest,
    agentId: z.string().nullable(),
    agentPoolId: z.string().nullable(),
    incidentId: z.string().nullable(),
    serviceId: z.string().nullable(),
    steps: z.array(
      z
        .object({
          key: z.string(),
          name: z.string(),
          type: z.string(),
          risk: z.string(),
          configuration: z.array(z.tuple([z.string(), z.string()])),
        })
        .strict()
    ),
  })
  .strict();

async function admit(context: ExecutionContext) {
  context.budget.consumeOperation();
  requireMcp(context.credentialId, 'MCP_INVALID_TOKEN', 401);
  const auth = await resolveMcpGrant(context.grantId, context.credentialId);
  auth.actor.apiKey = {
    id: auth.apiKey.id,
    scopes: auth.apiKey.scopes.filter(scope => context.tokenScopes.includes(scope)),
  };
  requireMcp(canUseReviewedRunbooks(auth.actor), 'MCP_OPERATION_FORBIDDEN', 403);
  await enforceV2RateLimit(auth.apiKey.id, 'WRITE');
  return auth;
}
async function lockPreview(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "RunbookPreviewAuthorization" WHERE id = ${id} FOR UPDATE`;
  const preview = await tx.runbookPreviewAuthorization.findUnique({ where: { id } });
  requireMcp(preview?.independentReview, 'MCP_APPROVAL_UNAVAILABLE', 404);
  return preview;
}
async function requesterAuthority(
  tx: Prisma.TransactionClient,
  preview: RunbookPreviewAuthorization,
  current?: ExecutionContext
) {
  requireMcp(
    preview.requesterGrantId && preview.requesterCredentialId,
    'MCP_APPROVAL_UNAVAILABLE',
    404
  );
  const auth = await lockMcpMutationAuthority(
    tx,
    {
      grantId: preview.requesterGrantId,
      credentialId: current?.credentialId,
      tokenScopes: current?.tokenScopes ?? MCP_REVIEWED_RUNBOOK_SCOPES,
    },
    MCP_REVIEWED_RUNBOOK_SCOPES,
    [AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE],
    undefined,
    // Only the requester's own execution is a capability use; reviewers may still decide.
    current ? ['runbook_execute_approved'] : []
  );
  requireMcp(auth.actor.id === preview.actorId, 'MCP_APPROVAL_UNAVAILABLE', 404);
  if (preview.incidentId) {
    await tx.$queryRaw`SELECT id FROM "Incident" WHERE id = ${preview.incidentId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "IncidentWatcher" WHERE "incidentId" = ${preview.incidentId}
      AND "userId" = ${auth.actor.id} FOR SHARE`;
    requireMcp(
      await tx.incident.findFirst({
        where: { AND: [{ id: preview.incidentId }, incidentReadWhere(auth.actor)] },
        select: { id: true },
      }),
      'MCP_RESOURCE_UNAVAILABLE',
      404
    );
  }
  if (preview.serviceId) {
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${preview.serviceId} FOR SHARE`;
    requireMcp(
      await tx.service.findFirst({
        where: { AND: [{ id: preview.serviceId }, serviceReadWhere(auth.actor)] },
        select: { id: true },
      }),
      'MCP_RESOURCE_UNAVAILABLE',
      404
    );
  }
  return auth;
}

export function prepareMcpRunbook(context: ExecutionContext, raw: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const input = prepareRunbookSchema.parse(raw);
      const initial = await admit(context);
      const result = await runSerializableTransaction(async tx => {
        context.budget.check();
        const auth = await lockMcpMutationAuthority(
          tx,
          context,
          MCP_REVIEWED_RUNBOOK_SCOPES,
          [AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE],
          initial.actor,
          ['runbook_prepare_execution']
        );
        const prepared = await executeIdempotentOperation(tx, {
          scope: 'mcp:runbook:prepare',
          context: { key: input.idempotencyKey, principalId: auth.apiKey.id },
          payload: { runbookId: input.runbookId, body: input.body },
          execute: async () => {
            // Same backlog cap as change requests. Inside execute, so a replay returns the stored
            // result; approved plans not yet run still count, like APPROVED changes do.
            const now = new Date();
            const pending = await tx.runbookPreviewAuthorization.count({
              where: {
                requesterGrantId: context.grantId,
                independentReview: true,
                consumedAt: null,
                rejectedAt: null,
                OR: [{ expiresAt: { gt: now } }, { commitDeadline: { gt: now } }],
              },
            });
            requireMcp(pending < MAX_PENDING_PER_GRANT, 'MCP_APPROVAL_BACKLOG', 429);
            const request = await resolveV2RunbookExecution(
              tx,
              { id: input.runbookId },
              input.body,
              auth.actor
            );
            const plan = await previewRunbookExecution(request, tx, {
              apiClientId: auth.apiKey.id,
            });
            requireMcp(plan.authorizationToken, 'MCP_APPROVAL_UNAVAILABLE', 503);
            const previewId = createHash('sha256').update(plan.authorizationToken).digest('hex');
            const version = await tx.runbookVersion.findUniqueOrThrow({
              where: { id: plan.versionId },
              select: { definition: true },
            });
            const authored = new Map(
              flattenSteps(parseRunbookDefinition(version.definition)).map(step => [step.key, step])
            );
            const summary = runbookReviewSummarySchema.parse({
              runbookId: input.runbookId,
              versionId: plan.versionId,
              version: plan.version,
              checksum: plan.checksum,
              agentId: plan.agentId,
              agentPoolId: plan.agentPoolId,
              incidentId: request.incidentId ?? null,
              serviceId: request.serviceId ?? null,
              steps: plan.steps.map(step => ({
                key: step.key,
                name: step.name,
                type: step.type,
                risk: step.risk,
                configuration: resolvedApprovalPlan(
                  step.type,
                  authored.get(step.key)?.config ?? {},
                  plan.inputs
                ),
              })),
            });
            // A second person needs time to notice and read the plan: the review window comes
            // from the MCP policy instead of the short native preview lifetime.
            const timing = await readMcpApprovalTiming(tx);
            const expiresAt = reviewDeadline(timing);
            await tx.runbookPreviewAuthorization.update({
              where: { id: previewId },
              data: {
                expiresAt,
                independentReview: true,
                requesterGrantId: context.grantId,
                requesterCredentialId: context.credentialId,
                requestEnvelope: await encrypt(
                  JSON.stringify({
                    request: { runbookId: input.runbookId, body: input.body },
                    authorizationToken: plan.authorizationToken,
                  })
                ),
                reviewSummary: summary as Prisma.InputJsonValue,
              },
            });
            await logAudit(
              {
                source: 'API',
                action: 'mcp.runbook.prepared',
                entityType: 'RUNBOOK',
                entityId: input.runbookId,
                actorId: auth.actor.id,
                details: { previewId, planDigest: plan.digest, grantId: context.grantId },
              },
              tx
            );
            await notifyRunbookReviewers(tx, {
              previewId,
              actorId: auth.actor.id,
              grantId: context.grantId,
              runbookId: input.runbookId,
              incidentId: request.incidentId ?? null,
              serviceId: request.serviceId ?? null,
              expiresAt,
            });
            return {
              previewId,
              planDigest: plan.digest,
              expiresAt: expiresAt.toISOString(),
              commitWindowMinutes: timing.commitWindowMinutes,
              status: 'REQUIRES_NATIVE_APPROVAL',
              reviewUrl: `${mcpOrigin()}/settings/integrations/mcp/approvals/${previewId}`,
              warnings: [
                'A user allowed to approve runbooks must approve this frozen plan in the native OpsKnight UI; an administrator may approve their own request after confirming.',
              ],
            };
          },
        });
        const bound = await tx.runbookPreviewAuthorization.findUnique({
          where: { id: prepared.value.previewId },
          select: {
            requesterGrantId: true,
            requesterCredentialId: true,
            expiresAt: true,
            consumedAt: true,
            rejectedAt: true,
          },
        });
        requireMcp(bound?.requesterGrantId === context.grantId, 'MCP_APPROVAL_UNAVAILABLE', 404);
        // A retried prepare must not hand back a plan that was rejected, used or has lapsed.
        if (prepared.replayed) {
          requireMcp(!bound.rejectedAt, 'MCP_APPROVAL_REJECTED', 409, REPREPARE_HINT);
          requireMcp(
            !bound.consumedAt && bound.expiresAt > new Date(),
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

export function executeApprovedMcpRunbook(context: ExecutionContext, raw: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const input = executeApprovedRunbookSchema.parse(raw);
      const initial = await admit(context);
      const result = await runSerializableTransaction(async tx => {
        context.budget.check();
        const preview = await lockPreview(tx, input.previewId);
        requireMcp(
          preview.requesterGrantId === context.grantId && preview.actorId === initial.actor.id,
          'MCP_APPROVAL_UNAVAILABLE',
          404
        );
        const auth = await requesterAuthority(tx, preview, context);
        const result = await executeIdempotentOperation(tx, {
          scope: 'mcp:runbook:execute',
          context: { key: input.idempotencyKey, principalId: auth.apiKey.id },
          payload: { previewId: input.previewId },
          execute: async () => {
            requireMcp(!preview.rejectedAt, 'MCP_APPROVAL_REJECTED', 403, REPREPARE_HINT);
            requireMcp(
              !preview.consumedAt && preview.expiresAt > new Date(),
              'MCP_APPROVAL_EXPIRED',
              409,
              REPREPARE_HINT
            );
            requireMcp(
              preview.reviewedAt && !preview.rejectedAt && preview.requestEnvelope,
              'MCP_APPROVAL_REQUIRED',
              403
            );
            const envelope = envelopeSchema.parse(
              JSON.parse(await decrypt(preview.requestEnvelope))
            );
            requireMcp(
              envelope.request.runbookId === preview.runbookId &&
                createHash('sha256').update(envelope.authorizationToken).digest('hex') ===
                  preview.id,
              'MCP_APPROVAL_UNAVAILABLE',
              409
            );
            const request = await resolveV2RunbookExecution(
              tx,
              { id: envelope.request.runbookId },
              envelope.request.body,
              auth.actor
            );
            const execution = await startRunbookExecution(
              {
                ...request,
                expectedPlanDigest: preview.planDigest,
                previewAuthorizationToken: envelope.authorizationToken,
              },
              tx,
              {
                apiClientId: auth.apiKey.id,
                independentPreview: {
                  grantId: context.grantId,
                  credentialId: context.credentialId!,
                },
              }
            );
            await tx.runbookPreviewAuthorization.update({
              where: { id: preview.id },
              data: { requestEnvelope: null },
            });
            await logAudit(
              {
                source: 'API',
                action: 'mcp.runbook.committed',
                entityType: 'RUNBOOK_EXECUTION',
                entityId: execution.id,
                actorId: auth.actor.id,
                details: {
                  previewId: preview.id,
                  planDigest: preview.planDigest,
                  grantId: context.grantId,
                },
              },
              tx
            );
            return {
              executionId: execution.id,
              status: execution.status,
              executionUrl: `${mcpOrigin()}/runbooks/executions/${execution.id}`,
            };
          },
        });
        return result;
      });
      context.budget.consumeResult(result.value);
      return result.value;
    })
  );
}

const REPREPARE_HINT = 'This plan is no longer open; prepare it again with a new idempotencyKey.';

type RunbookApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONSUMED';

/** Status from the stored columns, in precedence order. */
export function runbookApprovalStatus(
  preview: Pick<
    RunbookPreviewAuthorization,
    'consumedAt' | 'rejectedAt' | 'expiresAt' | 'reviewedAt'
  >,
  now = new Date()
): RunbookApprovalStatus {
  if (preview.consumedAt) return 'CONSUMED';
  if (preview.rejectedAt) return 'REJECTED';
  if (preview.expiresAt <= now) return 'EXPIRED';
  if (preview.reviewedAt) return 'APPROVED';
  return 'PENDING';
}

/** Read-only status for the requesting assistant; the preview id is not a bearer capability. */
export function getMcpRunbookApproval(context: ExecutionContext, raw: unknown) {
  return context.budget.track(
    withMcpDatabase(async () => {
      const input = runbookApprovalStatusSchema.parse(raw);
      context.budget.consumeOperation();
      requireMcp(context.credentialId, 'MCP_INVALID_TOKEN', 401);
      const auth = await resolveMcpGrant(context.grantId, context.credentialId);
      await enforceV2RateLimit(auth.apiKey.id, 'READ');
      const preview = await runSerializableTransaction(tx =>
        tx.runbookPreviewAuthorization.findUnique({ where: { id: input.previewId } })
      );
      requireMcp(
        preview?.independentReview &&
          preview.requesterGrantId === context.grantId &&
          preview.actorId === auth.actor.id,
        'MCP_APPROVAL_UNAVAILABLE',
        404
      );
      const status = runbookApprovalStatus(preview);
      const result = {
        previewId: preview.id,
        planDigest: preview.planDigest,
        status,
        expiresAt: preview.expiresAt.toISOString(),
        commitDeadline: preview.commitDeadline?.toISOString() ?? null,
        reviewedAt: preview.reviewedAt?.toISOString() ?? null,
        rejectedAt: preview.rejectedAt?.toISOString() ?? null,
        consumedAt: preview.consumedAt?.toISOString() ?? null,
        executionId: preview.executionId,
        reviewUrl: `${mcpOrigin()}/settings/integrations/mcp/approvals/${preview.id}`,
        ...untrustedDecisionReason(preview.decisionReason),
        ...(status === 'PENDING'
          ? { pollAfterSeconds: 30, poll: mcpApprovalPollGuidance(preview.expiresAt.toISOString()) }
          : {}),
        ...(status === 'APPROVED' ? { next: 'runbook_execute_approved' } : {}),
        ...(status === 'EXPIRED' || status === 'REJECTED' ? { hint: REPREPARE_HINT } : {}),
      };
      context.budget.consumeResult(result);
      return result;
    })
  );
}

/** The plan as its own requester sees it: status only. Null for anyone else. */
export async function loadMcpRunbookRequest(id: string, viewerId: string) {
  digest.parse(id);
  const preview = await runSerializableTransaction(tx =>
    tx.runbookPreviewAuthorization.findUnique({ where: { id } })
  );
  requireMcp(preview?.independentReview, 'MCP_APPROVAL_UNAVAILABLE', 404);
  return preview.actorId === viewerId ? preview : null;
}

/** Native page/action callers supply the authenticated session identity themselves. */
export async function loadMcpRunbookReview(
  id: string,
  reviewer: { id: string; tokenVersion: number }
) {
  digest.parse(id);
  return runSerializableTransaction(async tx => {
    const preview = await lockPreview(tx, id);
    const { selfReview } = await assertPreviewReviewer(tx, preview, reviewer);
    requireMcp(preview.expiresAt > new Date() && !preview.consumedAt, 'MCP_APPROVAL_EXPIRED', 409);
    await requesterAuthority(tx, preview);
    return {
      preview,
      selfReview,
      summary: runbookReviewSummarySchema.parse(preview.reviewSummary),
    };
  });
}
export async function decideMcpRunbookReview(
  raw: unknown,
  reviewer: { id: string; tokenVersion: number }
) {
  const input = z
    .object({
      id: digest,
      planDigest: digest,
      decision: z.enum(['approve', 'reject']),
      confirmSelfApproval: z.literal('yes').optional(),
      reason: decisionReasonSchema,
    })
    .strict()
    .parse(raw);
  return runSerializableTransaction(async tx => {
    const preview = await lockPreview(tx, input.id);
    await requesterAuthority(tx, preview);
    // Approval opens a fresh commit window, capped from the request; it replaces the review expiry.
    const deadline =
      input.decision === 'approve'
        ? commitDeadline(await readMcpApprovalTiming(tx), preview.createdAt)
        : undefined;
    await reviewRunbookPreview(
      tx,
      { ...input, reason: input.reason || undefined, commitDeadline: deadline },
      reviewer
    );
    await resolveReviewerNotices(tx, [preview.id], input.decision, new Date(), reviewer.id);
    await notifyRequesterOfDecision(tx, {
      id: preview.id,
      requesterId: preview.actorId,
      reviewerId: reviewer.id,
      kind: 'runbook',
      decision: input.decision,
      commitDeadline: deadline,
    });
  });
}
