import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  FEEDBACK_RATE_LIMIT,
  revokeFeedbackSchema,
  submitFeedbackSchema,
  type FeedbackSubjectType,
  type FeedbackVerdict,
} from './schema';

type Client = Prisma.TransactionClient | typeof prisma;

function validationError(issues: Array<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError({
    code: 'VALIDATION_FAILED',
    fields: issues.map(issue => ({
      field: issue.path.map(String).join('.') || 'input',
      message: issue.message,
    })),
  });
}

function assertMayGiveFeedback(actor: AuthorizationActor) {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'You do not have permission to give feedback on suggestions.',
    });
  }
}

/**
 * Resolves a feedback subject to the service it concerns, requiring that the actor can read every
 * incident involved. A subject the actor cannot see is reported as not found, never as forbidden, so
 * feedback cannot be used to probe for the existence of incidents.
 */
async function resolveSubject(
  client: Client,
  actor: AuthorizationActor,
  subjectType: FeedbackSubjectType,
  subjectId: string
): Promise<{ serviceId: string }> {
  const readable = incidentReadWhere(actor);
  const notFound = () => new AppError({ code: 'RESOURCE_NOT_FOUND' });

  const incidentIds: string[] = [];
  if (subjectType === 'FINDING') {
    const finding = await client.intelligenceFinding.findUnique({
      where: { id: subjectId },
      select: { incidentId: true, subjectRef: true },
    });
    if (!finding) throw notFound();
    incidentIds.push(finding.incidentId);
    if (finding.subjectRef) {
      // Only similar-incident findings reference another incident by id.
      const referenced = await client.incident.findUnique({
        where: { id: finding.subjectRef },
        select: { id: true },
      });
      if (referenced) incidentIds.push(referenced.id);
    }
  } else if (subjectType === 'CORRELATION_MEMBER') {
    const member = await client.correlationMember.findUnique({
      where: { id: subjectId },
      select: { incidentId: true },
    });
    if (!member) throw notFound();
    incidentIds.push(member.incidentId);
  } else {
    const relationship = await client.incidentRelationship.findUnique({
      where: { id: subjectId },
      select: { sourceIncidentId: true, targetIncidentId: true },
    });
    if (!relationship) throw notFound();
    incidentIds.push(relationship.sourceIncidentId, relationship.targetIncidentId);
  }

  const visible = await client.incident.findMany({
    where: { AND: [{ id: { in: incidentIds } }, readable] },
    select: { id: true, serviceId: true },
  });
  if (visible.length !== new Set(incidentIds).size) throw notFound();
  // The first incident is always the one the feedback is about.
  const primary = visible.find(incident => incident.id === incidentIds[0]);
  if (!primary) throw notFound();
  return { serviceId: primary.serviceId };
}

export interface FeedbackResult {
  verdict: FeedbackVerdict;
  replaced: boolean;
}

/**
 * Records the actor's verdict on a subject. Each actor has at most one live verdict per subject: a
 * new one replaces the old inside a transaction, so repeated clicks cannot inflate counts. Free-text
 * notes are stored but never copied into the audit log.
 */
export async function submitFeedback(
  actor: AuthorizationActor,
  input: unknown
): Promise<FeedbackResult> {
  assertMayGiveFeedback(actor);
  const parsed = submitFeedbackSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const data = parsed.data;

  const limit = await checkRateLimit(
    `intelligence-feedback:${actor.id}`,
    FEEDBACK_RATE_LIMIT.limit,
    FEEDBACK_RATE_LIMIT.windowMs
  );
  if (!limit.allowed) throw new AppError({ code: 'RATE_LIMIT_EXCEEDED' });

  return prisma.$transaction(async tx => {
    const { serviceId } = await resolveSubject(tx, actor, data.subjectType, data.subjectId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-feedback:${actor.id}:${data.subjectId}`}, 0))`;
    const removed = await tx.intelligenceFeedback.deleteMany({
      where: { actorId: actor.id, subjectType: data.subjectType, subjectId: data.subjectId },
    });
    await tx.intelligenceFeedback.create({
      data: {
        subjectType: data.subjectType,
        subjectId: data.subjectId,
        verdict: data.verdict,
        reasonCode: data.reasonCode ?? null,
        note: data.note ? data.note : null,
        serviceId,
        actorId: actor.id,
      },
    });
    await logAudit(
      {
        action: 'intelligence.feedback.submitted',
        entityType: 'SYSTEM_CONFIG',
        entityId: `intelligence-feedback:${data.subjectType}:${data.subjectId}`,
        actorId: actor.id,
        source: 'UI',
        details: { verdict: data.verdict, reasonCode: data.reasonCode ?? null, replaced: removed.count > 0 },
      },
      tx
    );
    return { verdict: data.verdict, replaced: removed.count > 0 };
  });
}

/** Withdraws the actor's own verdict. Idempotent: revoking nothing is not an error. */
export async function revokeFeedback(actor: AuthorizationActor, input: unknown): Promise<{ revoked: number }> {
  assertMayGiveFeedback(actor);
  const parsed = revokeFeedbackSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const { subjectType, subjectId } = parsed.data;
  const removed = await prisma.intelligenceFeedback.deleteMany({
    where: { actorId: actor.id, subjectType, subjectId },
  });
  return { revoked: removed.count };
}

/** The actor's own live verdicts for a set of subjects, for rendering controls in their saved state. */
export async function getMyFeedback(
  actor: AuthorizationActor,
  subjectType: FeedbackSubjectType,
  subjectIds: readonly string[],
  client: Client = prisma
): Promise<Map<string, FeedbackVerdict>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await client.intelligenceFeedback.findMany({
    where: { actorId: actor.id, subjectType, subjectId: { in: [...subjectIds] } },
    select: { subjectId: true, verdict: true },
  });
  return new Map(rows.map(row => [row.subjectId, row.verdict]));
}

export interface FeedbackSummary {
  total: number;
  positive: number;
  negative: number;
  /** positive / total, or null when there is no feedback yet. */
  positiveRate: number | null;
}

/**
 * Aggregate counts for dashboards and calibration. Counts live verdicts only; disabled users'
 * feedback is excluded so a deactivated account cannot keep influencing results.
 */
export async function summarizeFeedback(
  options: { subjectType?: FeedbackSubjectType; serviceId?: string; since?: Date } = {},
  client: Client = prisma
): Promise<FeedbackSummary> {
  const rows = await client.intelligenceFeedback.groupBy({
    by: ['verdict'],
    where: {
      ...(options.subjectType ? { subjectType: options.subjectType } : {}),
      ...(options.serviceId ? { serviceId: options.serviceId } : {}),
      ...(options.since ? { createdAt: { gte: options.since } } : {}),
      actor: { status: 'ACTIVE' },
    },
    _count: { _all: true },
  });
  let positive = 0;
  let negative = 0;
  for (const row of rows) {
    if (row.verdict === 'HELPFUL' || row.verdict === 'CORRECT') positive += row._count._all;
    else negative += row._count._all;
  }
  const total = positive + negative;
  return { total, positive, negative, positiveRate: total === 0 ? null : positive / total };
}
