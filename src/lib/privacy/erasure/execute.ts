import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { AppError } from '@/lib/errors/app-error';
import { isAppError } from '@/lib/errors';
import { runSerializableTransaction } from '@/lib/db-utils';
import { acquireAdvisoryLock, LOCK_KEYS } from '@/lib/db-locks';
import { transitionPrivacyRequest } from '@/lib/privacy/requests';
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
  /** True if a known-partial-coverage domain was non-empty; see policy.ts. */
  manualReviewRequired: boolean;
}

const PLAN_VERSION = 1;

/**
 * Thrown only from inside the destructive transaction when post-mutation
 * verification fails. Because it is thrown *inside* the transaction, Prisma
 * rolls the whole thing back automatically — nothing was actually deleted,
 * so the caller can treat this as an ordinary, safely-retryable failure.
 */
class ErasureVerificationFailure extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super('Erasure verification failed inside the destructive transaction; rolled back.');
    this.name = 'ErasureVerificationFailure';
    this.issues = issues;
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

type ClaimResult =
  | { kind: 'claimed'; executionId: string }
  | {
      kind: 'alreadyCompleted';
      executionId: string;
      domainCounts: ErasureDomainCounts;
      manualReviewRequired: boolean;
    };

/**
 * Atomically claims the right to run erasure for a request. Runs in its own
 * short SERIALIZABLE transaction so two concurrent executeErasure() calls can
 * never both pass this check: whichever caller wins the transition into
 * RUNNING (via a fresh create or a status-guarded updateMany) proceeds: every
 * other caller — including one that raced the unique-constraint create, or
 * lost the guarded updateMany — throws PRIVACY_ERASURE_IN_PROGRESS instead of
 * silently duplicating the destructive work below.
 */
async function claimExecution(requestId: string): Promise<ClaimResult> {
  return runSerializableTransaction(async tx => {
    const existing = await tx.privacyErasureExecution.findUnique({ where: { requestId } });

    if (!existing) {
      try {
        const created = await tx.privacyErasureExecution.create({
          data: { requestId, status: 'RUNNING', planVersion: PLAN_VERSION, startedAt: new Date() },
        });
        return { kind: 'claimed', executionId: created.id };
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          throw new AppError({ code: 'PRIVACY_ERASURE_IN_PROGRESS', details: { requestId } });
        }
        throw err;
      }
    }

    if (existing.status === 'COMPLETED') {
      return {
        kind: 'alreadyCompleted',
        executionId: existing.id,
        domainCounts: (existing.resultSummary as ErasureDomainCounts | null) ?? {},
        manualReviewRequired: existing.manualReviewRequired,
      };
    }
    if (existing.status === 'RUNNING') {
      // If the destructive transaction already committed (mutationCommittedAt
      // set atomically inside it), the process crashed between that commit and
      // the final COMPLETED bookkeeping. That retry must be allowed to resume
      // finalization; every other RUNNING means a genuinely concurrent execution
      // is still in flight and the caller must wait.
      if (existing.mutationCommittedAt) {
        return { kind: 'claimed', executionId: existing.id };
      }
      throw new AppError({ code: 'PRIVACY_ERASURE_IN_PROGRESS', details: { requestId } });
    }

    // PENDING / FAILED / PARTIAL: eligible for a fresh attempt. The
    // updateMany is guarded by the exact status we just read inside this
    // SERIALIZABLE transaction, so a concurrent claimer racing the same
    // transition either wins this guard or observes RUNNING/COMPLETED above.
    const claim = await tx.privacyErasureExecution.updateMany({
      where: { requestId, status: existing.status },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        failureCode: null,
      },
    });
    if (claim.count === 0) {
      throw new AppError({ code: 'PRIVACY_ERASURE_IN_PROGRESS', details: { requestId } });
    }
    return { kind: 'claimed', executionId: existing.id };
  });
}

/**
 * Executes a verified ERASURE request. Gating mirrors createExportArtifact()
 * in src/lib/privacy/export/artifact.ts: requestType must be ERASURE, the
 * request must be verified, and it must be in PROCESSING status.
 *
 * Idempotent and safe under concurrency:
 * - A second call against a COMPLETED execution is a no-op (claimExecution).
 * - A second call while RUNNING throws PRIVACY_ERASURE_IN_PROGRESS instead of
 *   racing the first call's destructive transaction.
 * - Verification runs *inside* the destructive transaction: a failure rolls
 *   the whole thing back, so nothing is ever left half-erased.
 * - Once the destructive transaction has committed (mutationCommittedAt is
 *   set), a retry never re-runs discovery/deletion — it goes straight to the
 *   finalization-only recovery path, because the subject no longer exists.
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

  const claim = await claimExecution(requestId);
  if (claim.kind === 'alreadyCompleted') {
    return {
      executionId: claim.executionId,
      status: 'COMPLETED',
      domainCounts: claim.domainCounts,
      manualReviewRequired: claim.manualReviewRequired,
    };
  }
  const executionId = claim.executionId;

  async function markClaimFailed(failureCode: string, reason: string) {
    await prisma.privacyErasureExecution.update({
      where: { id: executionId },
      data: { status: 'FAILED', failureCode },
    });
    await emitAuditEvent({
      action: 'privacy.erasure.failed',
      source: 'UI',
      target: { type: 'PRIVACY_ERASURE_EXECUTION', id: executionId },
      actor: { type: 'USER', id: actor.id },
      metadata: { requestId, reason },
    });
  }

  if (!request.verifiedAt || request.status !== 'PROCESSING') {
    await markClaimFailed('PREREQUISITES_NOT_MET', 'PREREQUISITES_NOT_MET');
    throw new AppError({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
      details: { verified: Boolean(request.verifiedAt), status: request.status },
    });
  }
  if (request.subjectType !== 'USER') {
    await markClaimFailed('PREREQUISITES_NOT_MET', 'PREREQUISITES_NOT_MET');
    throw new AppError({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
      details: { subjectType: request.subjectType },
    });
  }

  await emitAuditEvent({
    action: 'privacy.erasure.started',
    source: 'UI',
    target: { type: 'PRIVACY_ERASURE_EXECUTION', id: executionId },
    actor: { type: 'USER', id: actor.id },
    metadata: { requestId },
  });

  const subjectId = request.subjectId;
  let destructiveMutationCommitted = false;

  try {
    const subjectRow = await prisma.user.findUnique({
      where: { id: subjectId },
      select: { email: true },
    });

    let domainCounts: ErasureDomainCounts;
    let manualReviewRequired: boolean;

    if (subjectRow) {
      const plan = await buildSubjectErasurePlan(subjectId);
      if (!plan.canExecute) {
        await markClaimFailed('BLOCKED', 'BLOCKED');
        throw new AppError({
          code: 'PRIVACY_ERASURE_BLOCKED',
          details: { blockingConditions: plan.blockingConditions },
        });
      }

      const subjectEmail = subjectRow.email?.toLowerCase() ?? null;
      domainCounts = plan.domains.reduce<ErasureDomainCounts>((acc, domain) => {
        acc[domain.id] = domain.count;
        return acc;
      }, {});
      // Unconditional: any policy domain flagged manualReviewRequired is by
      // definition undiscoverable by ID (free text written by others, audit
      // details JSON, notification payloads, external/log sinks). A zero
      // author-count does not prove the subject is absent from someone else's
      // note or from a provider copy — see unstructuredDataReview.
      manualReviewRequired = plan.domains.some(domain => domain.manualReviewRequired);

      // Persisted durably *before* the destructive transaction runs: if a
      // later finalization step fails after the transaction commits, this
      // bookkeeping survives and a retry recovers it without needing to
      // re-derive anything from data that no longer exists.
      await prisma.privacyErasureExecution.update({
        where: { id: executionId },
        data: { resultSummary: domainCounts, manualReviewRequired },
      });

      await runSerializableTransaction(async tx => {
        await acquireAdvisoryLock(tx, LOCK_KEYS.PRIVACY_ERASURE);

        // Re-validate the request is still PROCESSING inside the same
        // SERIALIZABLE transaction that will mutate the subject. An admin
        // who moved the request to BLOCKED/REJECTED while erasure was
        // queued must not have the subject erased underneath that decision.
        const fresh = await tx.privacyRequest.findUnique({
          where: { id: requestId },
          select: { status: true, verifiedAt: true },
        });
        if (!fresh || fresh.status !== 'PROCESSING' || !fresh.verifiedAt) {
          throw new AppError({
            code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
            details: { status: fresh?.status ?? null, verified: Boolean(fresh?.verifiedAt) },
          });
        }

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
        // final user.deleteMany() below never hits a live FK-violation. Any
        // active/future on-call shift, rotation-layer membership, or override
        // must already have been reassigned — buildSubjectErasurePlan()
        // above blocks otherwise, so only purely historical rows remain.
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
        // Structured recipient fields, not just the userId reference — the
        // message body/payload/external provider copy remain out of scope
        // for automated cleanup (see the `notifications` manual-review domain).
        await tx.notification.updateMany({
          where: { userId: subjectId },
          data: { userId: null, recipientDisplay: null, recipientHash: null },
        });

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
        // subsequent user delete's cascade/SetNull).
        await tx.userToken.deleteMany({
          where: {
            OR: [{ userId: subjectId }, ...(subjectEmail ? [{ identifier: subjectEmail }] : [])],
          },
        });

        // --- DELETE: the User row itself. deleteMany (not delete) so a retry
        // after a post-commit finalization failure is a safe no-op instead of
        // throwing "record not found". Everything still pointing at it at
        // this point is a verified CASCADE or SetNull relation (avatar, OIDC
        // identities/linking approval, API keys, devices, dashboards, in-app
        // notifications, sessions/audit actorId).
        await tx.user.deleteMany({ where: { id: subjectId } });

        // Verification runs *inside* this transaction: a failure here throws
        // and Prisma rolls everything above back, so a bad plan/mutation
        // never leaves the subject half-erased.
        const verification = await verifySubjectErasure(
          subjectId,
          { originalEmail: subjectEmail },
          tx
        );
        if (!verification.verified) {
          throw new ErasureVerificationFailure(verification.issues);
        }

        // Persisted atomically with the destructive mutation itself so a
        // crash between transaction commit and a follow-up update cannot
        // leave (user = erased, execution = RUNNING, mutationCommittedAt =
        // null) — the exact window the recovery path is meant to close.
        await tx.privacyErasureExecution.update({
          where: { id: executionId },
          data: { mutationCommittedAt: new Date(), resultSummary: domainCounts, manualReviewRequired },
        });
      });

      destructiveMutationCommitted = true;
    } else {
      // Recovery path: nothing left to discover/mutate. Only take this
      // shortcut if *our own* prior attempt already committed the deletion —
      // otherwise the subject vanished through some unrelated path and that
      // is an anomaly an operator must investigate, not silently complete.
      const recovered = await prisma.privacyErasureExecution.findUniqueOrThrow({
        where: { id: executionId },
      });
      if (!recovered.mutationCommittedAt) {
        await markClaimFailed('SUBJECT_MISSING_UNEXPECTEDLY', 'SUBJECT_MISSING_UNEXPECTEDLY');
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage:
            'The subject no longer exists but this erasure never recorded a completed mutation. Investigate before retrying.',
        });
      }
      domainCounts = (recovered.resultSummary as ErasureDomainCounts | null) ?? {};
      manualReviewRequired = recovered.manualReviewRequired;
      destructiveMutationCommitted = true;
    }

    const completed = await prisma.privacyErasureExecution.update({
      where: { id: executionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultSummary: domainCounts,
        manualReviewRequired,
      },
    });

    await emitAuditEvent({
      action: 'privacy.erasure.completed',
      source: 'UI',
      target: { type: 'PRIVACY_ERASURE_EXECUTION', id: completed.id },
      actor: { type: 'USER', id: actor.id },
      metadata: { requestId, domainCounts, manualReviewRequired },
    });

    if (manualReviewRequired) {
      // Deliberately does NOT transition the request to COMPLETED — known
      // partial-coverage domains (free text, audit JSON, external provider
      // copies) mean an operator must review and complete it explicitly via
      // transitionPrivacyRequest(), never automatically here.
      await emitAuditEvent({
        action: 'privacy.erasure.manual_review_required',
        source: 'UI',
        target: { type: 'PRIVACY_REQUEST', id: requestId },
        actor: { type: 'USER', id: actor.id },
        metadata: { requestId },
      });
    } else {
      try {
        // The only sanctioned way to change a PrivacyRequest's status —
        // validates the transition and applies optimistic concurrency, so a
        // concurrent admin who moved the request to BLOCKED/REJECTED while
        // erasure was running is respected instead of silently overwritten.
        await transitionPrivacyRequest({ requestId, toStatus: 'COMPLETED' }, actor);
      } catch (transitionError) {
        // The subject's data is already erased either way — this failure
        // only means the request's own bookkeeping status didn't advance.
        await emitAuditEvent({
          action: 'privacy.erasure.request_completion_failed',
          source: 'UI',
          target: { type: 'PRIVACY_REQUEST', id: requestId },
          actor: { type: 'USER', id: actor.id },
          metadata: {
            requestId,
            reason: isAppError(transitionError) ? transitionError.code : 'UNKNOWN',
          },
        });
      }
    }

    return { executionId: completed.id, status: 'COMPLETED', domainCounts, manualReviewRequired };
  } catch (error) {
    if (error instanceof AppError && error.code === 'PRIVACY_ERASURE_BLOCKED') {
      // Already recorded (FAILED/BLOCKED) above before this was thrown.
      throw error;
    }

    if (error instanceof ErasureVerificationFailure) {
      // The transaction rolled back automatically — nothing was actually
      // deleted, so this is an ordinary, safely-retryable failure.
      await markClaimFailed('VERIFICATION_FAILED', 'VERIFICATION_FAILED');
      throw new AppError({
        code: 'PRIVACY_ERASURE_BLOCKED',
        userMessage: 'Erasure did not pass post-mutation verification and was rolled back.',
        details: { issues: error.issues },
      });
    }

    if (destructiveMutationCommitted) {
      // The subject IS already erased — never report this as an ordinary
      // FAILED, which would look safe to blindly retry from scratch. PARTIAL
      // plus a distinct failure code forces a retry through the recovery
      // path above instead of repeating any deletion.
      await prisma.privacyErasureExecution.update({
        where: { id: executionId },
        data: { status: 'PARTIAL', failureCode: 'FINALIZATION_FAILED' },
      });
      await emitAuditEvent({
        action: 'privacy.erasure.finalization_failed',
        source: 'UI',
        target: { type: 'PRIVACY_ERASURE_EXECUTION', id: executionId },
        actor: { type: 'USER', id: actor.id },
        metadata: { requestId },
      });
      throw new AppError({ code: 'PRIVACY_ERASURE_FINALIZATION_FAILED', cause: error });
    }

    const failureCode = error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN';
    await markClaimFailed(failureCode, 'ERROR');
    throw error;
  }
}
