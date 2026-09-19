import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type {
  ComplianceEvidenceType,
  ComplianceEvidenceRecord,
  EvidenceQueryResult,
} from './types';

export interface GetControlEvidenceOptions {
  controlId: string;
  type?: ComplianceEvidenceType;
  limit?: number;
  cursor?: string;
}

export interface GetEvaluationEvidenceOptions {
  evaluationId: string;
  limit?: number;
  cursor?: string;
}

export interface GetAllEvidenceOptions {
  controlId?: string;
  type?: ComplianceEvidenceType;
  limit?: number;
  cursor?: string;
}

function mapToRecord(row: {
  id: string;
  evaluationId: string;
  controlId: string;
  type: ComplianceEvidenceType;
  collectorId: string;
  collectorVersion: string;
  title: string;
  description: string | null;
  resourceType: string | null;
  resourceId: string | null;
  observedAt: Date;
  collectedAt: Date;
  validUntil: Date | null;
  contentHash: string;
  metadata: Prisma.JsonValue;
}): ComplianceEvidenceRecord {
  return {
    id: row.id,
    evaluationId: row.evaluationId,
    controlId: row.controlId,
    type: row.type,
    collectorId: row.collectorId,
    collectorVersion: row.collectorVersion,
    title: row.title,
    description: row.description,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    observedAt: row.observedAt,
    collectedAt: row.collectedAt,
    validUntil: row.validUntil,
    contentHash: row.contentHash,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export async function getControlEvidence(
  options: GetControlEvidenceOptions
): Promise<EvidenceQueryResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const where: Prisma.ComplianceEvidenceWhereInput = {
    controlId: options.controlId,
    ...(options.type ? { type: options.type } : {}),
  };

  const rows = await prisma.complianceEvidence.findMany({
    where,
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

  return {
    evidence: items.map(mapToRecord),
    nextCursor,
    hasMore,
  };
}

export async function getEvaluationEvidence(
  options: GetEvaluationEvidenceOptions
): Promise<EvidenceQueryResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const where: Prisma.ComplianceEvidenceWhereInput = {
    evaluationId: options.evaluationId,
  };

  const rows = await prisma.complianceEvidence.findMany({
    where,
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

  return {
    evidence: items.map(mapToRecord),
    nextCursor,
    hasMore,
  };
}

export async function getAllEvidence(
  options: GetAllEvidenceOptions = {}
): Promise<EvidenceQueryResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const where: Prisma.ComplianceEvidenceWhereInput = {
    ...(options.controlId ? { controlId: options.controlId } : {}),
    ...(options.type ? { type: options.type } : {}),
  };

  const rows = await prisma.complianceEvidence.findMany({
    where,
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

  return {
    evidence: items.map(mapToRecord),
    nextCursor,
    hasMore,
  };
}
