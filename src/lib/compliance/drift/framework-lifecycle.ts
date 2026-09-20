import type { Prisma } from '@prisma/client';
import { ALL_FRAMEWORK_REQUIREMENTS } from '../framework-mappings/requirements';
import { resolveRequirementLifecycle } from '../framework-mappings/lifecycle';
import { emitAuditEvent } from '../../audit';

export interface FrameworkLifecycleTransition {
  readonly framework: string;
  readonly requirementId: string;
  readonly previousLifecycle: string;
  readonly currentLifecycle: string;
  readonly title: string;
}

/**
 * Detects framework requirement lifecycle transitions across two points in time.
 * E.g., DPDP requirements moving from FUTURE to ACTIVE upon staged commencement date.
 */
export function detectFrameworkLifecycleTransitions(
  previousTime: Date,
  currentTime: Date
): FrameworkLifecycleTransition[] {
  const transitions: FrameworkLifecycleTransition[] = [];

  for (const req of ALL_FRAMEWORK_REQUIREMENTS) {
    const prevLifecycle = resolveRequirementLifecycle(req, previousTime);
    const currLifecycle = resolveRequirementLifecycle(req, currentTime);

    if (prevLifecycle !== currLifecycle) {
      transitions.push({
        framework: req.framework,
        requirementId: req.id,
        previousLifecycle: prevLifecycle,
        currentLifecycle: currLifecycle,
        title: req.title,
      });
    }
  }

  return transitions;
}

/**
 * Records framework requirement lifecycle changes durably in ComplianceDriftEvent.
 * These are strictly INFORMATIONAL legal/calendar milestone changes, never compliance failures.
 */
export async function recordFrameworkLifecycleTransitions(
  tx: Prisma.TransactionClient,
  transitions: readonly FrameworkLifecycleTransition[],
  now: Date = new Date()
): Promise<number> {
  let recorded = 0;

  for (const transition of transitions) {
    const dedupeKey = `framework-lifecycle:${transition.framework}:${transition.requirementId}:${transition.currentLifecycle}`;

    const existing = await tx.complianceDriftEvent.findFirst({
      where: {
        framework: transition.framework,
        requirementId: transition.requirementId,
        kind: 'FRAMEWORK_LIFECYCLE_CHANGED',
      },
    });

    if (existing) continue;

    await tx.complianceDriftEvent.create({
      data: {
        subjectType: 'FRAMEWORK_REQUIREMENT',
        subjectId: transition.requirementId,
        framework: transition.framework,
        requirementId: transition.requirementId,
        kind: 'FRAMEWORK_LIFECYCLE_CHANGED',
        impact: 'INFORMATIONAL',
        status: 'RESOLVED',
        fingerprint: dedupeKey,
        summary: `Framework requirement ${transition.requirementId} transitioned from ${transition.previousLifecycle} to ${transition.currentLifecycle}.`,
        details: {
          framework: transition.framework,
          requirementId: transition.requirementId,
          title: transition.title,
          previousLifecycle: transition.previousLifecycle,
          currentLifecycle: transition.currentLifecycle,
        },
        firstDetectedAt: now,
        lastObservedAt: now,
        resolvedAt: now,
      },
    });

    await emitAuditEvent({
      action: 'FRAMEWORK_LIFECYCLE_CHANGED',
      source: 'BACKGROUND',
      target: { type: 'COMPLIANCE_DRIFT_EVENT', id: transition.requirementId },
      actor: { type: 'SYSTEM' },
      occurredAt: now,
      metadata: {
        framework: transition.framework,
        requirementId: transition.requirementId,
        from: transition.previousLifecycle,
        to: transition.currentLifecycle,
      },
    });

    recorded++;
  }

  return recorded;
}
