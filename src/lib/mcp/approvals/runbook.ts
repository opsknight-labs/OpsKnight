import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma, RunbookPreviewAuthorization } from '@prisma/client';
import { z } from 'zod';
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
import { MCP_REVIEWED_RUNBOOK_SCOPES, canUseReviewedRunbooks } from './policy';

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
    [AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE]
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
          initial.actor
        );
        const prepared = await executeIdempotentOperation(tx, {
          scope: 'mcp:runbook:prepare',
          context: { key: input.idempotencyKey, principalId: auth.apiKey.id },
          payload: { runbookId: input.runbookId, body: input.body },
          execute: async () => {
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
            await tx.runbookPreviewAuthorization.update({
              where: { id: previewId },
              data: {
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
            return {
              previewId,
              planDigest: plan.digest,
              expiresAt: plan.expiresAt,
              status: 'REQUIRES_NATIVE_APPROVAL',
              reviewUrl: `${mcpOrigin()}/settings/integrations/mcp/approvals/${previewId}`,
              warnings: [
                'Only a different authorized user in the native UI can approve this frozen plan.',
              ],
            };
          },
        });
        const bound = await tx.runbookPreviewAuthorization.findUnique({
          where: { id: prepared.value.previewId },
          select: { requesterGrantId: true, requesterCredentialId: true },
        });
        requireMcp(bound?.requesterGrantId === context.grantId, 'MCP_APPROVAL_UNAVAILABLE', 404);
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
            requireMcp(
              !preview.consumedAt && preview.expiresAt > new Date(),
              'MCP_APPROVAL_EXPIRED',
              409
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

/** Native page/action callers supply the authenticated session identity themselves. */
export async function loadMcpRunbookReview(
  id: string,
  reviewer: { id: string; tokenVersion: number }
) {
  digest.parse(id);
  return runSerializableTransaction(async tx => {
    const preview = await lockPreview(tx, id);
    await assertPreviewReviewer(tx, preview, reviewer);
    requireMcp(preview.expiresAt > new Date() && !preview.consumedAt, 'MCP_APPROVAL_EXPIRED', 409);
    await requesterAuthority(tx, preview);
    return { preview, summary: runbookReviewSummarySchema.parse(preview.reviewSummary) };
  });
}
export async function decideMcpRunbookReview(
  raw: unknown,
  reviewer: { id: string; tokenVersion: number }
) {
  const input = z
    .object({ id: digest, planDigest: digest, decision: z.enum(['approve', 'reject']) })
    .strict()
    .parse(raw);
  return runSerializableTransaction(async tx => {
    const preview = await lockPreview(tx, input.id);
    await requesterAuthority(tx, preview);
    await reviewRunbookPreview(tx, input, reviewer);
  });
}
