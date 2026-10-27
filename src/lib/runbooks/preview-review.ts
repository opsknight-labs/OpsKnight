import 'server-only';
import type { Prisma, RunbookPreviewAuthorization } from '@prisma/client';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { enforceV2Authorization } from '@/lib/api-v2/rbac';
import { logAudit } from '@/lib/audit';
import { RunbookDefinitionError } from './errors';

function requireReview(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RunbookDefinitionError(code);
}

/** Shared native-review boundary. Approval never grants new resource authority. */
export async function assertPreviewReviewer(
  tx: Prisma.TransactionClient,
  preview: RunbookPreviewAuthorization,
  actor: { id: string; tokenVersion: number }
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TeamMember" WHERE "userId" = ${actor.id} ORDER BY id FOR SHARE`;
  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: {
      id: true,
      role: true,
      status: true,
      tokenVersion: true,
      teamMemberships: { select: { teamId: true } },
    },
  });
  requireReview(
    user?.status === 'ACTIVE' && user.tokenVersion === actor.tokenVersion,
    'PREVIEW_REVIEW_APPROVER_CHANGED'
  );
  const reviewer = authorizationActorFromUser(user);
  requireReview(
    reviewer && reviewer.id !== preview.actorId,
    'PREVIEW_REVIEW_DISTINCT_ACTOR_REQUIRED'
  );
  enforceV2Authorization(reviewer, AUTHORIZATION_ACTIONS.RUNBOOK_APPROVE);
  enforceV2Authorization(reviewer, AUTHORIZATION_ACTIONS.RUNBOOK_READ);
  if (preview.incidentId) {
    await tx.$queryRaw`SELECT id FROM "Incident" WHERE id = ${preview.incidentId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "IncidentWatcher" WHERE "incidentId" = ${preview.incidentId}
      AND "userId" = ${actor.id} FOR SHARE`;
    requireReview(
      await tx.incident.findFirst({
        where: { AND: [{ id: preview.incidentId }, incidentReadWhere(reviewer)] },
        select: { id: true },
      }),
      'PREVIEW_REVIEW_RESOURCE_UNAVAILABLE'
    );
  }
  if (preview.serviceId) {
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${preview.serviceId} FOR SHARE`;
    requireReview(
      await tx.service.findFirst({
        where: { AND: [{ id: preview.serviceId }, serviceReadWhere(reviewer)] },
        select: { id: true },
      }),
      'PREVIEW_REVIEW_RESOURCE_UNAVAILABLE'
    );
  }
}

/** Called by the existing execution command before consuming its preview capability. */
export async function assertIndependentPreviewReview(
  tx: Prisma.TransactionClient,
  preview: RunbookPreviewAuthorization,
  provenance?: { grantId: string; credentialId: string }
) {
  if (!preview.independentReview) {
    requireReview(!provenance, 'PREVIEW_REVIEW_REQUIRED');
    return;
  }
  requireReview(
    provenance && provenance.grantId === preview.requesterGrantId,
    'PREVIEW_REVIEW_PROVENANCE_REQUIRED'
  );
  requireReview(
    await tx.mcpToken.findFirst({
      where: {
        id: provenance.credentialId,
        grantId: provenance.grantId,
        rotatedAt: null,
        accessExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    }),
    'PREVIEW_REVIEW_PROVENANCE_REQUIRED'
  );
  requireReview(
    preview.reviewedAt &&
      !preview.rejectedAt &&
      preview.reviewedById &&
      preview.reviewerTokenVersion !== null &&
      preview.reviewedPlanDigest === preview.planDigest,
    'PREVIEW_REVIEW_REQUIRED'
  );
  await assertPreviewReviewer(tx, preview, {
    id: preview.reviewedById,
    tokenVersion: preview.reviewerTokenVersion,
  });
}

/** Caller authenticates a native session; no MCP or REST approval endpoint exists. */
export async function reviewRunbookPreview(
  tx: Prisma.TransactionClient,
  input: { id: string; planDigest: string; decision: 'approve' | 'reject' },
  actor: { id: string; tokenVersion: number }
) {
  await tx.$queryRaw`SELECT id FROM "RunbookPreviewAuthorization" WHERE id = ${input.id} FOR UPDATE`;
  const preview = await tx.runbookPreviewAuthorization.findUnique({ where: { id: input.id } });
  requireReview(
    preview?.independentReview && !preview.consumedAt && preview.expiresAt > new Date(),
    'PREVIEW_REVIEW_EXPIRED'
  );
  requireReview(preview.planDigest === input.planDigest, 'PREVIEW_REVIEW_PLAN_CHANGED');
  requireReview(!preview.reviewedAt && !preview.rejectedAt, 'PREVIEW_ALREADY_REVIEWED');
  await assertPreviewReviewer(tx, preview, actor);
  const changed = await tx.runbookPreviewAuthorization.updateMany({
    where: {
      id: preview.id,
      consumedAt: null,
      reviewedAt: null,
      rejectedAt: null,
      planDigest: input.planDigest,
      expiresAt: { gt: new Date() },
    },
    data:
      input.decision === 'approve'
        ? {
            reviewedById: actor.id,
            reviewerTokenVersion: actor.tokenVersion,
            reviewedAt: new Date(),
            reviewedPlanDigest: preview.planDigest,
          }
        : { rejectedAt: new Date(), requestEnvelope: null },
  });
  requireReview(changed.count === 1, 'PREVIEW_ALREADY_REVIEWED');
  await logAudit(
    {
      source: 'UI',
      action: `runbook.preview.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
      entityType: 'RUNBOOK',
      entityId: preview.runbookId,
      actorId: actor.id,
      details: {
        previewId: preview.id,
        planDigest: preview.planDigest,
        requesterGrantId: preview.requesterGrantId,
      },
    },
    tx
  );
}
