import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { redactNotificationError } from '@/lib/notification-operations';
import { resolveIncidentResponderRouting } from './routing';

export type EscalationStepOutcome = 'COMPLETED' | 'SCHEDULED' | 'RUNNING' | 'FAILED' | 'UNCERTAIN';

export type EscalationStepHealth = {
  stepIndex: number;
  stepNumber: number;
  outcome: EscalationStepOutcome;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  failedAt: string | null;
  completedAt: string | null;
  targetLabel: string | null;
  /** True when the incident timeline records this step's page. */
  timelineEvidence: boolean;
  /** True when a later step of the same generation completed. */
  continuedAfter: boolean;
};

export type EscalationExecutionHealth = {
  generation: number;
  incidentEscalationStatus: string | null;
  steps: EscalationStepHealth[];
  needsAttention: boolean;
};

export type EscalationJobRow = {
  stepIndex: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  failedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

const MAX_STEPS = 50;
const LEVEL_PATTERN = /\(Level (\d+)\b/;

function jobPriority(job: EscalationJobRow): number {
  if (job.status === 'COMPLETED') return 3;
  if (job.status === 'FAILED') return 1;
  return 2;
}

function outcomeFor(job: EscalationJobRow | undefined, timelineEvidence: boolean): EscalationStepOutcome {
  if (!job) return 'COMPLETED';
  if (job.status === 'COMPLETED') return 'COMPLETED';
  if (job.status === 'FAILED') return timelineEvidence ? 'UNCERTAIN' : 'FAILED';
  if (job.status === 'PROCESSING' || job.status === 'PROCESSING_V2') return 'RUNNING';
  return 'SCHEDULED';
}

/**
 * A FAILED job and a completed later step are independent facts: the later step
 * says nothing about whether this step's page was sent. The timeline event is
 * written in the same transaction as the step's notification intents, so its
 * absence on a FAILED job means the step committed nothing; its presence means
 * the work happened but the job never recorded completion.
 */
export function classifyEscalationSteps(input: {
  generation: number;
  incidentEscalationStatus: string | null;
  jobs: EscalationJobRow[];
  timelineLevels: ReadonlySet<number>;
  targetLabels?: ReadonlyArray<string | null>;
}): EscalationExecutionHealth {
  const best = new Map<number, EscalationJobRow>();
  for (const job of input.jobs) {
    const current = best.get(job.stepIndex);
    if (
      !current ||
      jobPriority(job) > jobPriority(current) ||
      (jobPriority(job) === jobPriority(current) && job.createdAt > current.createdAt)
    )
      best.set(job.stepIndex, job);
  }
  const indexes = new Set<number>(best.keys());
  for (const level of input.timelineLevels) indexes.add(level - 1);

  const steps = [...indexes]
    .filter(index => index >= 0 && index < MAX_STEPS)
    .sort((a, b) => a - b)
    .map<EscalationStepHealth>(stepIndex => {
      const job = best.get(stepIndex);
      const timelineEvidence = input.timelineLevels.has(stepIndex + 1);
      return {
        stepIndex,
        stepNumber: stepIndex + 1,
        outcome: outcomeFor(job, timelineEvidence),
        attempts: job?.attempts ?? 0,
        maxAttempts: job?.maxAttempts ?? 0,
        error: job?.status === 'FAILED' ? redactNotificationError(job.error) : null,
        failedAt: job?.failedAt?.toISOString() ?? null,
        completedAt: job?.completedAt?.toISOString() ?? null,
        targetLabel: input.targetLabels?.at(stepIndex) ?? null,
        timelineEvidence,
        continuedAfter: false,
      };
    });
  for (const step of steps)
    step.continuedAfter = steps.some(
      later => later.stepIndex > step.stepIndex && later.outcome === 'COMPLETED'
    );
  return {
    generation: input.generation,
    incidentEscalationStatus: input.incidentEscalationStatus,
    steps,
    needsAttention:
      input.incidentEscalationStatus === 'FAILED' ||
      steps.some(step => step.outcome === 'FAILED' || step.outcome === 'UNCERTAIN'),
  };
}

function targetLabel(step: {
  targetType: string;
  targetUser?: { name: string } | null;
  targetTeam?: { name: string } | null;
  targetSchedule?: { name: string } | null;
}): string {
  if (step.targetType === 'USER') return step.targetUser?.name ?? 'User';
  if (step.targetType === 'TEAM') return step.targetTeam?.name ?? 'Team';
  return step.targetSchedule?.name ?? 'On-call schedule';
}

/** Step jobs are found by exact logical key, which the escalation job index serves. */
export async function getEscalationExecutionHealth(
  incidentId: string
): Promise<EscalationExecutionHealth | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      serviceId: true,
      escalationStatus: true,
      escalationGeneration: true,
      currentEscalationStep: true,
    },
  });
  if (!incident) return null;
  const generation = incident.escalationGeneration ?? 0;

  let labels: Array<string | null> = [];
  try {
    const routing = await resolveIncidentResponderRouting(incidentId, incident.serviceId);
    labels = (routing.policy?.steps ?? []).map(step => targetLabel(step));
  } catch (error) {
    logger.warn('escalation.health.routing_unavailable', { incidentId, error });
  }

  const stepCount = Math.min(
    MAX_STEPS,
    Math.max(labels.length, (incident.currentEscalationStep ?? 0) + 1, 1)
  );
  const keys = Array.from(
    { length: stepCount },
    (_, step) => `ESCALATION:${incidentId}:${generation}:${step}`
  );
  const rows = await prisma.$queryRaw<
    Array<{
      stepIndex: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      error: string | null;
      failedAt: Date | null;
      completedAt: Date | null;
      createdAt: Date;
    }>
  >(Prisma.sql`
    SELECT payload #>> ARRAY['stepIndex']::text[] AS "stepIndex", status::text AS status,
           attempts, "maxAttempts", error, "failedAt", "completedAt", "createdAt"
    FROM "BackgroundJob"
    WHERE type = 'ESCALATION'::"JobType"
      AND payload #> ARRAY['logicalKey']::text[] IN (${Prisma.join(
        keys.map(key => Prisma.sql`${JSON.stringify(key)}::jsonb`)
      )})
  `);
  const jobs: EscalationJobRow[] = rows
    .map(row => ({ ...row, stepIndex: Number(row.stepIndex) }))
    .filter(row => Number.isInteger(row.stepIndex));

  const earliest = jobs.reduce<Date | null>(
    (min, job) => (!min || job.createdAt < min ? job.createdAt : min),
    null
  );
  const events = await prisma.incidentEvent.findMany({
    where: {
      incidentId,
      type: 'ESCALATED',
      message: { contains: '(Level ' },
      ...(generation > 0 && earliest ? { createdAt: { gte: earliest } } : {}),
    },
    select: { message: true },
    take: 200,
  });
  const timelineLevels = new Set<number>();
  for (const event of events) {
    const match = LEVEL_PATTERN.exec(event.message);
    if (match) timelineLevels.add(Number(match[1]));
  }

  return classifyEscalationSteps({
    generation,
    incidentEscalationStatus: incident.escalationStatus ?? null,
    jobs,
    timelineLevels,
    targetLabels: labels,
  });
}
