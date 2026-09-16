import 'server-only';

import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { AppError } from '@/lib/errors/app-error';
import { runSerializableTransaction } from '@/lib/db-utils';
import { acquireAdvisoryLock, LOCK_KEYS } from '@/lib/db-locks';
import { buildSubjectErasurePlan } from './plan';
import { verifySubjectErasure } from './verify';
import type { ErasureDomainCounts } from './discover';

export interface ErasureActor {
  id: string;
}

export interface ErasureExecutionResult {
  executionId: string;
  status: 'COMPLETED';
  domainCounts: ErasureDomainCounts;
}

const PLAN_VERSION = 1;

/**
 * Executes a verified ERASURE request. Idempotent: a second call against a
 * request whose execution already COMPLETED is a safe no-op that returns the
 * original result without touching any data. Gating mirrors
 * createExportArtifact() in src/lib/privacy/export/artifact.ts exactly —
 * requestType must be ERASURE, the request must be verified, and it must be
 * in PROCESSING status.
 */
export async function executeErasure(
  requestId: string,
  actor: ErasureActor
): Promise<ErasureExecutionResult> {
  const request = await prisma.privacyRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    throw new AppError({ code: 'PRIVACY_REQUEST_NOT_FOUND' });
  }
  if (request.requestType !== 'ERASURE') {
    throw new AppError({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
      details: { requestType: request.requestType },
    });
  }

  // Idempotency check happens before any prerequisite/gating re-validation so
  // a repeated call is always a safe no-op, even if the request's own status
  // has since moved on (e.g. to COMPLETED) as a result of the first call.
  const existingExecution = await prisma.privacyErasureExecution.findUnique({
    where: { requestId },
  });
  if (existingExecution?.status === 'COMPLETED') {
    return {
      executionId: existingExecution.id,
      status: 'COMPLETED',
      domainCounts: (existingExecution.resultSummary as ErasureDomainCounts | null) ?? {},
    };
  }

  if (!request.verifiedAt || request.status !== 'PROCESSING') {
    throw new AppError({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
      details: { verified: Boolean(request.verifiedAt), status: request.status },
    });
  }
  if (request.subjectType !== 'USER') {
    throw new AppError({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
      details: { subjectType: request.subjectType },
    });
  }

  const execution = await prisma.privacyErasureExecution.upsert({
    where: { requestId },
    create: { requestId, status: 'RUNNING', planVersion: PLAN_VERSION, startedAt: new Date() },
    update: { status: 'RUNNING', startedAt: new Date(), failureCode: null },
  });

  await emitAuditEvent({
    action: 'privacy.erasure.started',
    source: 'UI',
    target: { type: 'PRIVACY_ERASURE_EXECUTION', id: execution.id },
    actor: { type: 'USER', id: actor.id },
    metadata: { requestId },
  });

  const subjectId = request.subjectId;

  try {
    const plan = await buildSubjectErasurePlan(subjectId);
    if (!plan.canExecute) {
      await prisma.privacyErasureExecution.update({
        where: { id: execution.id },
        data: { status: 'FAILED', failureCode: 'BLOCKED' },
      });
      await emitAuditEvent({
        action: 'privacy.erasure.failed',
        source: 'UI',
        target: { type: 'PRIVACY_ERASURE_EXECUTION', id: execution.id },
        actor: { type: 'USER', id: actor.id },
        metadata: {
          requestId,
          reason: 'BLOCKED',
          blockingConditionCount: plan.blockingConditions.length,
        },
      });
      throw new AppError({
        code: 'PRIVACY_ERASURE_BLOCKED',
        details: { blockingConditions: plan.blockingConditions },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: subjectId },
      select: { email: true },
    });
    if (!user) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Subject user no longer exists.',
      });
    }
    const subjectEmail = user.email?.toLowerCase() ?? null;

    const domainCounts = {
      ...plan.domains.reduce<ErasureDomainCounts>((acc, domain) => {
        acc[domain.id] = domain.count;
        return acc;
      }, {}),
    };

    await runSerializableTransaction(async tx => {
      await acquireAdvisoryLock(tx, LOCK_KEYS.PRIVACY_ERASURE);

      // --- ANONYMIZE: scrub the immutable audit-log PII snapshot in place.
      // actorId itself is left alone here; it is SetNull automatically when
      // the User row is deleted below. This must run before that delete so
      // the actorId = subjectId predicate below still matches.
      await tx.auditLog.updateMany({
        where: { actorId: subjectId },
        data: { actorEmail: null, actorName: null },
      });
      if (subjectEmail) {
        await tx.auditLog.updateMany({
          where: { targetEmail: subjectEmail },
          data: { targetEmail: null },
        });
      }

      // --- DELETE: rows whose FK to User is ON DELETE RESTRICT in the
      // applied migrations (verified against prisma/migrations/*.sql, not
      // just schema.prisma's @relation annotations, which have drifted from
      // the DB for a couple of these). Deleting explicitly here means the
      // final user.delete() below never hits a live FK-violation.
      await tx.teamMember.deleteMany({ where: { userId: subjectId } });
      await tx.incidentWatcher.deleteMany({ where: { userId: subjectId } });
      await tx.onCallShift.deleteMany({ where: { userId: subjectId } });
      await tx.onCallLayerUser.deleteMany({ where: { userId: subjectId } });
      await tx.onCallOverride.deleteMany({
        where: { OR: [{ userId: subjectId }, { replacesUserId: subjectId }] },
      });

      // --- DETACH: nullify attribution fields defensively. Several of these
      // are DB-level SetNull already; nulling them here is a harmless no-op
      // in that case and load-bearing where the DB constraint is still
      // RESTRICT (OidcConfig.updatedBy, SlackIntegration.installedBy).
      await tx.oidcConfig.updateMany({
        where: { updatedBy: subjectId },
        data: { updatedBy: null },
      });
      await tx.slackIntegration.updateMany({
        where: { installedBy: subjectId },
        data: { installedBy: null },
      });
      await tx.slackOAuthConfig.updateMany({
        where: { updatedBy: subjectId },
        data: { updatedBy: null },
      });
      await tx.notificationProvider.updateMany({
        where: { updatedBy: subjectId },
        data: { updatedBy: null },
      });
      await tx.microsoftTeamsConfig.updateMany({
        where: { updatedBy: subjectId },
        data: { updatedBy: null },
      });
      await tx.microsoftTeamsInstallation.updateMany({
        where: { installedBy: subjectId },
        data: { installedBy: null },
      });
      await tx.microsoftTeamsDestination.updateMany({
        where: { updatedBy: subjectId },
        data: { updatedBy: null },
      });
      await tx.team.updateMany({ where: { teamLeadId: subjectId }, data: { teamLeadId: null } });
      await tx.incidentNote.updateMany({ where: { userId: subjectId }, data: { userId: null } });
      await tx.postmortem.updateMany({
        where: { createdById: subjectId },
        data: { createdById: null },
      });
      await tx.incidentTemplate.updateMany({
        where: { createdById: subjectId },
        data: { createdById: null },
      });
      await tx.actionItem.updateMany({ where: { ownerId: subjectId }, data: { ownerId: null } });
      await tx.notification.updateMany({ where: { userId: subjectId }, data: { userId: null } });

      // --- ANONYMIZE: incidents keep every timestamp/SLA field untouched;
      // only the assignee reference is cleared (DB-level SetNull covers this
      // too, but is made explicit for auditability of what execute() did).
      await tx.incident.updateMany({
        where: { assigneeId: subjectId },
        data: { assigneeId: null },
      });

      // Security/invite tokens tied to this identity by userId, plus any
      // still-pending invite/reset tokens keyed only by email identifier
      // (these predate account linkage and are never touched by the
      // subsequent user.delete() cascade/SetNull).
      await tx.userToken.deleteMany({
        where: {
          OR: [{ userId: subjectId }, ...(subjectEmail ? [{ identifier: subjectEmail }] : [])],
        },
      });

      // --- DELETE: the User row itself. Everything still pointing at it at
      // this point is a verified CASCADE or SetNull relation (avatar, OIDC
      // identities/linking approval, API keys, devices, dashboards, in-app
      // notifications, sessions/audit actorId).
      await tx.user.delete({ where: { id: subjectId } });
    });

    const verification = await verifySubjectErasure(subjectId, { originalEmail: subjectEmail });

    if (!verification.verified) {
      const partial = await prisma.privacyErasureExecution.update({
        where: { id: execution.id },
        data: {
          status: 'PARTIAL',
          completedAt: new Date(),
          resultSummary: domainCounts,
          failureCode: 'VERIFICATION_FAILED',
        },
      });
      await emitAuditEvent({
        action: 'privacy.erasure.failed',
        source: 'UI',
        target: { type: 'PRIVACY_ERASURE_EXECUTION', id: partial.id },
        actor: { type: 'USER', id: actor.id },
        metadata: {
          requestId,
          reason: 'VERIFICATION_FAILED',
          issueCount: verification.issues.length,
        },
      });
      // Deliberately left in PROCESSING, not COMPLETED — a human must inspect
      // verification.issues before this request can be closed out.
      throw new AppError({
        code: 'PRIVACY_ERASURE_BLOCKED',
        userMessage: 'Erasure ran but post-execution verification found residual data.',
        details: { issues: verification.issues },
      });
    }

    const completed = await prisma.privacyErasureExecution.update({
      where: { id: execution.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultSummary: domainCounts,
      },
    });

    await emitAuditEvent({
      action: 'privacy.erasure.completed',
      source: 'UI',
      target: { type: 'PRIVACY_ERASURE_EXECUTION', id: completed.id },
      actor: { type: 'USER', id: actor.id },
      metadata: { requestId, domainCounts },
    });

    await prisma.privacyRequest.updateMany({
      where: { id: requestId, status: 'PROCESSING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await emitAuditEvent({
      action: 'privacy.request.completed',
      source: 'UI',
      target: { type: 'PRIVACY_REQUEST', id: requestId },
      actor: { type: 'USER', id: actor.id },
      metadata: { requestType: 'ERASURE' },
    });

    return { executionId: completed.id, status: 'COMPLETED', domainCounts };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'PRIVACY_ERASURE_BLOCKED') {
      const failureCode = error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN';
      await prisma.privacyErasureExecution.update({
        where: { id: execution.id },
        data: { status: 'FAILED', failureCode },
      });
      await emitAuditEvent({
        action: 'privacy.erasure.failed',
        source: 'UI',
        target: { type: 'PRIVACY_ERASURE_EXECUTION', id: execution.id },
        actor: { type: 'USER', id: actor.id },
        metadata: { requestId, reason: 'ERROR' },
      });
    }
    throw error;
  }
}
