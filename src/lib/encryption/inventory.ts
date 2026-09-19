/**
 * Inventory scanner for encrypted fields across OpsKnight models.
 * Reads records in cursor-based batches and classifies stored secrets.
 */

import { PrismaClient } from '@prisma/client';
import { EncryptionTargetDefinition, TargetInspectionStats } from './types';
import { inspectTargetRecord } from './inspect';

export interface PrismaModelDelegate {
  findMany(args?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  count(args?: Record<string, unknown>): Promise<number>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  findUnique(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  [key: string]: unknown;
}

export function getModelDelegate(prisma: PrismaClient, modelName: string): PrismaModelDelegate {
  const propertyName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const delegate = Reflect.get(prisma, propertyName) as PrismaModelDelegate | undefined;
  if (!delegate) {
    throw new Error(
      `Prisma model delegate not found for model: ${modelName} (property: ${propertyName})`
    );
  }
  return delegate;
}

export interface ScanBatchResult {
  recordsScanned: number;
  nextCursor: string | null;
  hasMore: boolean;
  stats: TargetInspectionStats;
  records: Array<{ id: string; rawRecord: Record<string, unknown> }>;
}

export async function scanTargetBatch(
  prisma: PrismaClient,
  target: EncryptionTargetDefinition,
  cursor: string | null,
  batchSize: number,
  keyring: Array<{ id: string; key: string }>,
  activeKeyId: string | null
): Promise<ScanBatchResult> {
  const delegate = getModelDelegate(prisma, target.model);

  const whereClause: Record<string, unknown> = {};
  if (target.filter) {
    Object.assign(whereClause, target.filter);
  }
  if (cursor) {
    whereClause.id = { gt: cursor };
  }

  const selectClause: Record<string, boolean> = { id: true };
  selectClause[target.field] = true;

  const rows = await delegate.findMany({
    where: whereClause,
    orderBy: { id: 'asc' },
    take: batchSize + 1,
    select: selectClause,
  });

  const hasMore = rows.length > batchSize;
  const currentBatch = hasMore ? rows.slice(0, batchSize) : rows;
  const nextCursor =
    currentBatch.length > 0 && typeof currentBatch[currentBatch.length - 1].id === 'string'
      ? (currentBatch[currentBatch.length - 1].id as string)
      : null;

  const stats: TargetInspectionStats = {
    targetId: target.id,
    totalRecords: 0,
    currentV3: 0,
    oldKeyV3: 0,
    legacyV2: 0,
    legacyV1: 0,
    plaintext: 0,
    unavailableKey: 0,
    ambiguous: 0,
    unreadable: 0,
    empty: 0,
    keysDetected: {},
  };

  const records: Array<{ id: string; rawRecord: Record<string, unknown> }> = [];

  for (const row of currentBatch) {
    stats.totalRecords++;
    const rowId = typeof row.id === 'string' ? row.id : String(row.id ?? '');
    const inspections = await inspectTargetRecord(row, target, keyring, activeKeyId);

    for (const insp of inspections) {
      switch (insp.classification) {
        case 'CURRENT_V3':
          stats.currentV3++;
          break;
        case 'OLD_KEY_V3':
          stats.oldKeyV3++;
          break;
        case 'LEGACY_V2':
          stats.legacyV2++;
          break;
        case 'LEGACY_V1':
          stats.legacyV1++;
          break;
        case 'PLAINTEXT':
          stats.plaintext++;
          break;
        case 'UNAVAILABLE_KEY':
          stats.unavailableKey++;
          break;
        case 'AMBIGUOUS':
          stats.ambiguous++;
          break;
        case 'UNREADABLE':
          stats.unreadable++;
          break;
        case 'EMPTY':
          stats.empty++;
          break;
      }

      if (insp.detectedKeyId) {
        stats.keysDetected[insp.detectedKeyId] = (stats.keysDetected[insp.detectedKeyId] || 0) + 1;
      }
    }

    records.push({ id: rowId, rawRecord: row });
  }

  return {
    recordsScanned: currentBatch.length,
    nextCursor,
    hasMore,
    stats,
    records,
  };
}

export async function countTargetTotal(
  prisma: PrismaClient,
  target: EncryptionTargetDefinition
): Promise<number> {
  const delegate = getModelDelegate(prisma, target.model);
  const whereClause: Record<string, unknown> = {};
  if (target.filter) {
    Object.assign(whereClause, target.filter);
  }
  return await delegate.count({ where: whereClause });
}
