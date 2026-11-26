import 'server-only';
import { z } from 'zod/v4';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { wouldCreateCycle } from './graph';
import { recordDependencyEvent } from './insights/history';
import { memoizeIntelligenceRead, parseOrThrow, type IntelligenceActor } from '../settings/service';

export const MAX_DEPENDENCIES = 5000;

const declareSchema = z
  .object({
    upstreamServiceId: z.string().trim().min(1).max(64),
    downstreamServiceId: z.string().trim().min(1).max(64),
    dependencyType: z.enum(['HARD', 'SOFT']).optional(),
    note: z.string().trim().max(500).nullable().optional(),
    criticality: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
  })
  .strict()
  .refine(value => value.upstreamServiceId !== value.downstreamServiceId, {
    message: 'A service cannot depend on itself',
    path: ['upstreamServiceId'],
  });

const auditSource = (actor: IntelligenceActor) => ({
  source: actor.source,
  details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
});

function invalid(message: string): AppError {
  return new AppError({
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'input', code: 'custom', message }],
  });
}

export interface DependencyView {
  id: string;
  upstreamServiceId: string;
  upstreamName: string;
  downstreamServiceId: string;
  downstreamName: string;
  origin: 'DECLARED' | 'OBSERVED';
  status: 'ACTIVE' | 'SUGGESTED' | 'REJECTED';
  confidence: number;
}

export async function listDependencies(client: typeof prisma = prisma): Promise<DependencyView[]> {
  // ACTIVE sorts before SUGGESTED; within a status the most recently touched edges come first, so the
  // bounded page is never an arbitrary slice of a large topology.
  const rows = await client.serviceDependency.findMany({
    where: { status: { in: ['ACTIVE', 'SUGGESTED'] } },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: MAX_DEPENDENCIES,
    select: {
      id: true,
      origin: true,
      status: true,
      confidence: true,
      upstream: { select: { id: true, name: true } },
      downstream: { select: { id: true, name: true } },
    },
  });
  return rows.map(row => ({
    id: row.id,
    upstreamServiceId: row.upstream.id,
    upstreamName: row.upstream.name,
    downstreamServiceId: row.downstream.id,
    downstreamName: row.downstream.name,
    origin: row.origin,
    status: row.status,
    confidence: row.confidence,
  }));
}

/**
 * Active edges only; suggested and rejected edges never influence analysis. Most recently touched first, so
 * when a topology exceeds the cap the edges that fall off are the stalest, not a random set.
 */
export async function loadActiveEdges(client: Prisma.TransactionClient | typeof prisma = prisma) {
  return memoizeIntelligenceRead('dependency-edges', client, () =>
    client.serviceDependency.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: MAX_DEPENDENCIES,
      select: { upstreamServiceId: true, downstreamServiceId: true },
    })
  );
}

/** One writer at a time, so two concurrent edge activations cannot close a cycle between them. */
async function lockDependencyEdges(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('service-dependency-edges', 0))`;
}

/** Call under lockDependencyEdges: reads the active edges fresh and throws if the edge closes a cycle. */
async function assertNoCycle(
  tx: Prisma.TransactionClient,
  upstreamServiceId: string,
  downstreamServiceId: string
) {
  const cycle = wouldCreateCycle(await loadActiveEdges(tx), {
    upstreamServiceId,
    downstreamServiceId,
  });
  if (!cycle) return;
  const names = new Map(
    (
      await tx.service.findMany({ where: { id: { in: cycle } }, select: { id: true, name: true } })
    ).map(row => [row.id, row.name])
  );
  throw invalid(
    `That dependency would create a cycle: ${cycle.map(id => names.get(id) ?? 'a service').join(' → ')}.`
  );
}

/** Caller must authorize INTELLIGENCE_MANAGE. Declares (or re-activates) "downstream depends on upstream". */
export async function declareDependency(input: unknown, actor: IntelligenceActor) {
  const { upstreamServiceId, downstreamServiceId, dependencyType, note, criticality } =
    parseOrThrow(declareSchema, input);
  // Only what the caller sent changes on an existing edge; null clears a note or criticality.
  const semantics = {
    ...(dependencyType !== undefined && { dependencyType }),
    ...(note !== undefined && { note: note || null }),
    ...(criticality !== undefined && { criticality }),
  };
  const key = { upstreamServiceId_downstreamServiceId: { upstreamServiceId, downstreamServiceId } };
  return prisma.$transaction(async tx => {
    await lockDependencyEdges(tx);
    const services = await tx.service.count({
      where: { id: { in: [upstreamServiceId, downstreamServiceId] } },
    });
    if (services !== 2) throw invalid('Unknown service');
    const existing = await tx.serviceDependency.findUnique({
      where: key,
      select: { id: true, status: true },
    });
    if (existing?.status !== 'ACTIVE')
      await assertNoCycle(tx, upstreamServiceId, downstreamServiceId);
    // Rejected edges are a permanent human record, not topology; they never consume the cap.
    if (
      !existing &&
      (await tx.serviceDependency.count({ where: { status: { not: 'REJECTED' } } })) >=
        MAX_DEPENDENCIES
    ) {
      throw invalid('Dependency limit reached');
    }
    const row = await tx.serviceDependency.upsert({
      where: key,
      create: {
        upstreamServiceId,
        downstreamServiceId,
        origin: 'DECLARED',
        status: 'ACTIVE',
        confidence: 1,
        evidence: { type: 'declared' },
        ...semantics,
      },
      update: {
        origin: 'DECLARED',
        status: 'ACTIVE',
        confidence: 1,
        evidence: { type: 'declared' },
        ...semantics,
      },
      select: { id: true },
    });
    await recordDependencyEvent(tx, {
      upstreamServiceId,
      downstreamServiceId,
      state: 'ACTIVE',
      origin: 'DECLARED',
      actorId: actor.actorId,
    });
    await logAudit(
      {
        action: 'intelligence.dependency.declared',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: actor.actorId,
        ...auditSource(actor),
        newValue: { upstreamServiceId, downstreamServiceId, ...semantics },
      },
      tx
    );
    return row;
  });
}

/** Approves or rejects a suggested edge. Only SUGGESTED edges can be reviewed. */
export async function reviewDependency(
  id: string,
  decision: 'APPROVE' | 'REJECT',
  actor: IntelligenceActor
): Promise<'updated' | 'not_found'> {
  return prisma.$transaction(async tx => {
    await lockDependencyEdges(tx);
    const row = await tx.serviceDependency.findUnique({
      where: { id },
      select: { status: true, origin: true, upstreamServiceId: true, downstreamServiceId: true },
    });
    if (!row || row.status !== 'SUGGESTED') return 'not_found';
    if (decision === 'APPROVE')
      await assertNoCycle(tx, row.upstreamServiceId, row.downstreamServiceId);
    await tx.serviceDependency.update({
      where: { id },
      data: { status: decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED' },
    });
    await recordDependencyEvent(tx, {
      upstreamServiceId: row.upstreamServiceId,
      downstreamServiceId: row.downstreamServiceId,
      state: decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED',
      origin: row.origin,
      actorId: actor.actorId,
    });
    await logAudit(
      {
        action:
          decision === 'APPROVE'
            ? 'intelligence.dependency.approved'
            : 'intelligence.dependency.rejected',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.actorId,
        ...auditSource(actor),
        newValue: {
          upstreamServiceId: row.upstreamServiceId,
          downstreamServiceId: row.downstreamServiceId,
        },
      },
      tx
    );
    return 'updated';
  });
}

export async function removeDependency(
  id: string,
  actor: IntelligenceActor
): Promise<'removed' | 'not_found'> {
  return prisma.$transaction(async tx => {
    const row = await tx.serviceDependency.findUnique({
      where: { id },
      select: { upstreamServiceId: true, downstreamServiceId: true, origin: true },
    });
    if (!row) return 'not_found';
    await tx.serviceDependency.delete({ where: { id } });
    await recordDependencyEvent(tx, {
      upstreamServiceId: row.upstreamServiceId,
      downstreamServiceId: row.downstreamServiceId,
      state: 'REMOVED',
      origin: row.origin,
      actorId: actor.actorId,
    });
    await logAudit(
      {
        action: 'intelligence.dependency.removed',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: row,
      },
      tx
    );
    return 'removed';
  });
}
