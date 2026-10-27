import prisma from '@/lib/prisma';

/** Planning occurs when the durable parent executes, never at HTTP admission.
 * A queued event therefore observes configuration enabled before its execution.
 * This snapshot is local to one execution; retries read configuration again.
 */
export interface IncidentEffectPlan {
  readonly collaboration: 'DISABLED' | 'EXECUTE';
  readonly chatOpsRevision: number | null;
}

export async function planIncidentEffects(parentAttempt?: number): Promise<IncidentEffectPlan> {
  // Reclaimed/retried/legacy parents can overlap an older writer whose delivery
  // is not committed yet. Keep the original unique-key handoff on those paths.
  if (parentAttempt !== 1) return Object.freeze({ collaboration: 'EXECUTE', chatOpsRevision: null });
  // A missing row is the documented disabled default. Errors must propagate:
  // unavailable configuration is not evidence that work is unnecessary.
  const config = await prisma.chatOpsConfig.findUnique({
    where: { id: 'default' },
    select: { enabled: true, revision: true },
  });
  return Object.freeze({
    collaboration: config === null || config.enabled === false ? 'DISABLED' : 'EXECUTE',
    chatOpsRevision: config?.revision ?? null,
  });
}
