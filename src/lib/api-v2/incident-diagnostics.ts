import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere, runbookExecutionReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { buildCursorWhere, formatCursorPagination, parsePaginationParams } from './pagination';

export async function requireIncidentDiagnosticAccess(actor: AuthorizationActor, incidentId: string) {
  if (!incidentId || incidentId.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });
  const incident = await prisma.incident.findFirst({
    where: { AND: [{ id: incidentId }, incidentReadWhere(actor)] },
    select: { id: true },
  });
  if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
}

export function incidentCorrelationHash(value: string): string {
  const key = process.env.API_V2_CURSOR_SECRET || process.env.NEXTAUTH_SECRET;
  if (!key && process.env.NODE_ENV !== 'test') {
    throw new AppError({ code: 'INTERNAL_ERROR' });
  }
  return createHmac('sha256', key || 'test-response-correlation-only')
    .update(value)
    .digest('hex');
}

export async function listIncidentExecutionPage(
  actor: AuthorizationActor,
  incidentId: string,
  searchParams: URLSearchParams
) {
  const { limit, cursor } = parsePaginationParams(searchParams);
  const cursorWhere = buildCursorWhere(cursor);
  const filters: Prisma.RunbookExecutionWhereInput[] = [
    { incidentId }, runbookExecutionReadWhere(actor),
  ];
  if (cursorWhere.OR) filters.push(cursorWhere as Prisma.RunbookExecutionWhereInput);
  const rows = await prisma.runbookExecution.findMany({
    where: { AND: filters },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true, runbookId: true, incidentId: true, status: true,
      triggeredByType: true, startedAt: true, completedAt: true, createdAt: true,
      recoveryOutcome: true,
      runbook: { select: { id: true, name: true, slug: true } },
    },
  });
  return formatCursorPagination(rows, limit);
}
