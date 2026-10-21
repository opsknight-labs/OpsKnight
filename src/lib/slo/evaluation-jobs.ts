import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { serviceObjectiveReadWhere } from './authorization';
import { evaluateServiceObjective, objectiveWindowDays } from './evaluator';
import type { ServiceObjectiveEvaluation } from './types';

const task = 'SERVICE_OBJECTIVE_EVALUATE';
function authorizationContext(actor: AuthorizationActor) {
  return createHash('sha256')
    .update(JSON.stringify({ role: actor.role, teamIds: [...actor.teamIds].sort() }))
    .digest('hex');
}
export const objectiveEvaluationRequest = z
  .object({
    expectedVersionId: z.string().min(1).max(100),
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const evaluationSchema = z
  .object({
    objectiveId: z.string(),
    metric: z.string(),
    value: z.number().nullable(),
    target: z.number(),
    comparator: z.enum(['GREATER_THAN_OR_EQUAL', 'LESS_THAN_OR_EQUAL']),
    compliant: z.boolean().nullable(),
    breached: z.boolean().nullable(),
    sampleCount: z.number().nullable(),
    sampleCountExact: z.string().nullable().optional(),
    elapsedSumMs: z.string().nullable().optional(),
    periodStart: z.string(),
    periodEnd: z.string(),
    dataState: z.enum(['AVAILABLE', 'NO_DATA', 'UNAVAILABLE']),
    definitionVersion: z.number(),
    coverage: z
      .object({ effectiveStart: z.string(), effectiveEnd: z.string(), complete: z.boolean() })
      .optional(),
  })
  .strict();
const payloadSchema = z
  .object({
    task: z.literal(task),
    lineageId: z.string(),
    versionId: z.string(),
    actorId: z.string(),
    apiClientId: z.string(),
    authorizationContext: z.string().regex(/^[a-f0-9]{64}$/),
    start: z.string().datetime(),
    end: z.string().datetime(),
    receipt: z
      .object({
        outcome: z.enum(['EVALUATED', 'ACCESS_REVOKED']),
        completedAt: z.string().datetime(),
        evaluation: evaluationSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
type Payload = z.infer<typeof payloadSchema>;

export async function requestObjectiveEvaluation(
  tx: Prisma.TransactionClient,
  lineageId: string,
  input: z.infer<typeof objectiveEvaluationRequest>,
  actor: AuthorizationActor,
  apiClientId: string
) {
  const objective = await tx.serviceObjective.findFirst({
    where: { id: input.expectedVersionId, lineageId, ...serviceObjectiveReadWhere(actor) },
  });
  if (!objective) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const end = input.end ? new Date(input.end) : new Date();
  const start = input.start
    ? new Date(input.start)
    : new Date(
        end.getTime() - objectiveWindowDays(objective.windowType, objective.windowValue) * 86400000
      );
  if (
    start >= end ||
    end.getTime() > Date.now() + 1000 ||
    end.getTime() - start.getTime() > 3650 * 86400000
  )
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Evaluation requires an ordered non-future period of at most 3650 days.',
    });
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('service-objective-evaluation-admission',0))`;
  const active = await tx.$queryRaw<
    { total: bigint; owned: bigint }[]
  >`SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE payload->>'apiClientId'=${apiClientId}) AS owned FROM "BackgroundJob" WHERE type='SCHEDULED_TASK'::"JobType" AND status IN ('PENDING','PROCESSING') AND payload->>'task'='SERVICE_OBJECTIVE_EVALUATE'`;
  if (Number(active[0]?.total ?? 0) >= 16 || Number(active[0]?.owned ?? 0) >= 2)
    throw new AppError({
      code: 'RATE_LIMIT_EXCEEDED',
      userMessage:
        'Evaluation capacity is full (two active jobs per credential and sixteen globally). Wait for accepted jobs to finish.',
    });
  const payload: Payload = {
    task,
    lineageId,
    versionId: objective.id,
    actorId: actor.id,
    apiClientId,
    authorizationContext: authorizationContext(actor),
    start: start.toISOString(),
    end: end.toISOString(),
  };
  const job = await tx.backgroundJob.create({
    data: {
      id: randomUUID(),
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      scheduledAt: new Date(),
      maxAttempts: 3,
      payload,
    },
  });
  await emitAuditEvent(
    {
      action: 'service_objective.evaluation.requested',
      source: 'API',
      actor: { type: 'USER', id: actor.id },
      target: {
        type: objective.serviceId ? 'SERVICE' : 'SYSTEM_CONFIG',
        id: objective.serviceId ?? lineageId,
      },
      metadata: { jobId: job.id, lineageId, versionId: objective.id, apiClientId },
    },
    tx
  );
  return project(job);
}

async function currentActor(db: Prisma.TransactionClient, payload: Payload) {
  const key = await db.apiKey.findFirst({
    where: {
      id: payload.apiClientId,
      userId: payload.actorId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          teamMemberships: { select: { teamId: true } },
        },
      },
    },
  });
  if (!key || key.user.status !== 'ACTIVE') return null;
  const principal = authorizationActorFromUser(key.user);
  if (!principal) return null;
  const actor: AuthorizationActor = { ...principal, apiKey: { id: key.id, scopes: key.scopes } };
  return authorizationContext(actor) === payload.authorizationContext &&
    authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_EVALUATE }).allowed
    ? actor
    : null;
}
function serialize(result: ServiceObjectiveEvaluation) {
  return evaluationSchema.parse({
    ...result,
    periodStart: result.periodStart.toISOString(),
    periodEnd: result.periodEnd.toISOString(),
    ...(result.coverage
      ? {
          coverage: {
            ...result.coverage,
            effectiveStart: result.coverage.effectiveStart.toISOString(),
            effectiveEnd: result.coverage.effectiveEnd.toISOString(),
          },
        }
      : {}),
  });
}
export async function processObjectiveEvaluation(jobId: string, claimToken?: string | null) {
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
  const payload = payloadSchema.parse(job.payload);
  if (payload.receipt) return;
  if (job.status !== 'PROCESSING' || (claimToken !== undefined && job.claimToken !== claimToken))
    throw new Error('Objective evaluation job claim is no longer current.');
  const actor = await currentActor(prisma, payload);
  const objective = actor
    ? await prisma.serviceObjective.findFirst({
        where: {
          id: payload.versionId,
          lineageId: payload.lineageId,
          ...serviceObjectiveReadWhere(actor),
        },
      })
    : null;
  const evaluated =
    actor && objective
      ? serialize(
          await evaluateServiceObjective({
            actor,
            objective,
            start: new Date(payload.start),
            end: new Date(payload.end),
          })
        )
      : undefined;
  await runSerializableTransaction(async tx => {
    const current = await tx.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
    const latest = payloadSchema.parse(current.payload);
    if (latest.receipt) return;
    if (current.status !== 'PROCESSING' || current.claimToken !== job.claimToken)
      throw new Error('Objective evaluation job claim was replaced.');
    // Recheck authority after analytics and before disclosing a persisted result.
    const stillActor = await currentActor(tx, payload);
    const stillVisible = stillActor
      ? await tx.serviceObjective.findFirst({
          where: {
            id: payload.versionId,
            lineageId: payload.lineageId,
            ...serviceObjectiveReadWhere(stillActor),
          },
          select: { id: true },
        })
      : null;
    const permitted = !!(stillActor && stillVisible && evaluated);
    const receipt: NonNullable<Payload['receipt']> = {
      outcome: permitted ? 'EVALUATED' : 'ACCESS_REVOKED',
      completedAt: new Date().toISOString(),
      ...(permitted ? { evaluation: evaluated } : {}),
    };
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: { payload: { ...latest, receipt } },
    });
    await emitAuditEvent(
      {
        action: 'service_objective.evaluation.completed',
        source: 'API',
        actor: permitted ? { type: 'USER', id: payload.actorId } : { type: 'SYSTEM' },
        target: { type: 'SYSTEM_CONFIG', id: payload.lineageId },
        metadata: {
          jobId,
          lineageId: payload.lineageId,
          versionId: payload.versionId,
          apiClientId: payload.apiClientId,
          outcome: receipt.outcome,
        },
      },
      tx
    );
  });
}
export async function readObjectiveEvaluationJob(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  lineageId: string,
  jobId: string
) {
  const job = await db.backgroundJob.findUnique({ where: { id: jobId } });
  const parsed = payloadSchema.safeParse(job?.payload);
  if (
    !job ||
    !parsed.success ||
    parsed.data.lineageId !== lineageId ||
    (parsed.data.actorId !== actor.id && actor.role !== 'ADMIN') ||
    (actor.role !== 'ADMIN' && authorizationContext(actor) !== parsed.data.authorizationContext)
  )
    throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const visible = await db.serviceObjective.findFirst({
    where: { id: parsed.data.versionId, lineageId, ...serviceObjectiveReadWhere(actor) },
    select: { id: true },
  });
  if (!visible) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return project(job);
}
function project(job: {
  id: string;
  status: string;
  attempts: number;
  createdAt: Date;
  completedAt: Date | null;
  payload: Prisma.JsonValue;
}) {
  const payload = payloadSchema.parse(job.payload);
  return {
    id: job.id,
    objectiveId: payload.lineageId,
    versionId: payload.versionId,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    result: payload.receipt ?? null,
    errorCode: job.status === 'FAILED' ? 'EVALUATION_FAILED' : null,
  };
}
