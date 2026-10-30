import 'server-only';
import { z } from 'zod/v4';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { memoizeIntelligenceRead, parseOrThrow, type IntelligenceActor } from '../settings/service';

export const MAX_DEPENDENCIES = 5000;

const declareSchema = z
  .object({
    upstreamServiceId: z.string().trim().min(1).max(64),
    downstreamServiceId: z.string().trim().min(1).max(64),
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
  const rows = await client.serviceDependency.findMany({
    where: { status: { in: ['ACTIVE', 'SUGGESTED'] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
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

/** Active edges only; suggested and rejected edges never influence analysis. */
export async function loadActiveEdges(client: Prisma.TransactionClient | typeof prisma = prisma) {
  return memoizeIntelligenceRead('dependency-edges', client, () =>
    client.serviceDependency.findMany({
      where: { status: 'ACTIVE' },
      take: MAX_DEPENDENCIES,
      select: { upstreamServiceId: true, downstreamServiceId: true },
    })
  );
}

/** Caller must authorize INTELLIGENCE_MANAGE. Declares (or re-activates) "downstream depends on upstream". */
export async function declareDependency(input: unknown, actor: IntelligenceActor) {
  const { upstreamServiceId, downstreamServiceId } = parseOrThrow(declareSchema, input);
  const key = { upstreamServiceId_downstreamServiceId: { upstreamServiceId, downstreamServiceId } };
  return prisma.$transaction(async tx => {
    const services = await tx.service.count({
      where: { id: { in: [upstreamServiceId, downstreamServiceId] } },
    });
    if (services !== 2) throw invalid('Unknown service');
    const existing = await tx.serviceDependency.findUnique({ where: key, select: { id: true } });
    if (!existing && (await tx.serviceDependency.count()) >= MAX_DEPENDENCIES) {
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
      },
      update: {
        origin: 'DECLARED',
        status: 'ACTIVE',
        confidence: 1,
        evidence: { type: 'declared' },
      },
      select: { id: true },
    });
    await logAudit(
      {
        action: 'intelligence.dependency.declared',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: actor.actorId,
        ...auditSource(actor),
        newValue: { upstreamServiceId, downstreamServiceId },
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
    const row = await tx.serviceDependency.findUnique({
      where: { id },
      select: { status: true, upstreamServiceId: true, downstreamServiceId: true },
    });
    if (!row || row.status !== 'SUGGESTED') return 'not_found';
    await tx.serviceDependency.update({
      where: { id },
      data: { status: decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED' },
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
      select: { upstreamServiceId: true, downstreamServiceId: true },
    });
    if (!row) return 'not_found';
    await tx.serviceDependency.delete({ where: { id } });
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
