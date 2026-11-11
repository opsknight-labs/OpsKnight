import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { checkRateLimit } from '@/lib/rate-limit';
import { FEEDBACK_RATE_LIMIT } from '../feedback/schema';
import { OPS_INSIGHT_DECISIONS, type OpsInsightDecision, type OpsInsightStatus } from './contract';
import { readableOpsInsightScopes } from './view';

const decisionSchema = z
  .object({ id: z.string().min(1).max(64), decision: z.enum(OPS_INSIGHT_DECISIONS) })
  .strict();

/** Which statuses a decision may be taken from, and where it leads. RESOLVED insights are not actionable. */
const TRANSITIONS: Record<OpsInsightDecision, { from: OpsInsightStatus[]; to: OpsInsightStatus }> =
  {
    accept: { from: ['OPEN'], to: 'ACCEPTED' },
    dismiss: { from: ['OPEN', 'ACCEPTED'], to: 'DISMISSED' },
    reopen: { from: ['ACCEPTED', 'DISMISSED'], to: 'OPEN' },
  };

/**
 * Records a person's decision on an insight: accept ("I will act on this"), dismiss ("not useful") or reopen.
 * Same controls as feedback on incident suggestions: the feedback capability, the shared rate limit, an
 * audit entry in the same transaction, and "not found" (never "forbidden") for an insight the actor cannot
 * see, so decisions cannot be used to probe for scopes. Repeating a decision is a no-op.
 *
 * Accepting changes nothing but the insight: the fix is made by a person in the feature's own editor.
 */
export async function decideInsight(
  actor: AuthorizationActor,
  input: unknown
): Promise<{ status: OpsInsightStatus; changed: boolean }> {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'You do not have permission to act on insights.',
    });
  }
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: 'VALIDATION_FAILED' });
  const { id, decision } = parsed.data;

  const limit = await checkRateLimit(
    `intelligence-feedback:${actor.id}`,
    FEEDBACK_RATE_LIMIT.limit,
    FEEDBACK_RATE_LIMIT.windowMs
  );
  if (!limit.allowed) throw new AppError({ code: 'RATE_LIMIT_EXCEEDED' });

  return prisma.$transaction(async tx => {
    const notFound = () => new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const insight = await tx.opsInsight.findUnique({
      where: { id },
      select: { id: true, scopeType: true, scopeId: true, kind: true, key: true, status: true },
    });
    if (!insight) throw notFound();
    const readable = await readableOpsInsightScopes(
      actor,
      insight.scopeType,
      [insight.scopeId],
      tx
    );
    if (!readable.has(insight.scopeId)) throw notFound();

    const { from, to } = TRANSITIONS[decision];
    if (insight.status === to) return { status: to, changed: false };
    // Compare-and-set: the lane may have resolved the insight since the page was rendered.
    const updated = await tx.opsInsight.updateMany({
      where: { id, status: { in: from } },
      data:
        to === 'OPEN'
          ? { status: to, decidedById: null, decidedAt: null }
          : { status: to, decidedById: actor.id, decidedAt: new Date() },
    });
    if (updated.count === 0) throw notFound();
    await logAudit(
      {
        action: `intelligence.ops_insight.${decision}`,
        entityType: 'SYSTEM_CONFIG',
        entityId: `ops-insight:${insight.id}`,
        actorId: actor.id,
        source: 'UI',
        details: {
          scopeType: insight.scopeType,
          scopeId: insight.scopeId,
          kind: insight.kind,
          key: insight.key,
          from: insight.status,
          to,
        },
      },
      tx
    );
    return { status: to, changed: true };
  });
}
