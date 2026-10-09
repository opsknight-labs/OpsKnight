import { describe, expect, it, vi } from 'vitest';
import { persistObservationBatch } from '@/lib/automation/observation-batch';
import type { ObservationJob } from '@/lib/automation/jobs';
import type { Prisma } from '@prisma/client';

describe('persistObservationBatch', () => {
  const currentJob: ObservationJob = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: 'current-event',
    serviceId: 'srv-1',
    integrationId: 'int-1',
    integrationType: 'CLOUDWATCH',
    observations: [
      { key: 'env', path: 'detail.env', value: 'prod', type: 'ENUM', unmapped: true },
      { key: 'severity', path: 'detail.severity', value: 'critical', type: 'STRING', unmapped: false },
    ],
  };

  const siblingJob1: ObservationJob = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: 'sibling-event-1',
    serviceId: 'srv-1',
    integrationId: 'int-1',
    integrationType: 'CLOUDWATCH',
    observations: [
      { key: 'region', path: 'detail.region', value: 'us-east-1', type: 'STRING', unmapped: true },
      { key: 'cluster', path: 'detail.cluster', value: 'prod-eks', type: 'STRING', unmapped: true },
    ],
  };

  const siblingJob2: ObservationJob = {
    task: 'AUTOMATION_OBSERVE',
    logicalKey: 'sibling-event-2',
    serviceId: 'srv-1',
    integrationId: 'int-2',
    integrationType: 'DATADOG',
    observations: [
      { key: 'tier', path: 'tags.tier', value: 'backend', type: 'STRING', unmapped: false },
      { key: 'custom_flag', path: 'tags.flag', value: 'true', type: 'BOOLEAN', unmapped: true },
    ],
  };

  function createMockTx(options?: {
    receiptExists?: boolean;
    pendingRows?: Array<{ id: string; payload: unknown }>;
    existingReceipts?: Array<{ id: string }>;
  }) {
    const { receiptExists = false, pendingRows = [], existingReceipts = [] } = options ?? {};

    return {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue(pendingRows),
      backgroundJob: {
        findUnique: vi.fn().mockResolvedValue(receiptExists ? { id: 'mock-receipt' } : null),
        findMany: vi.fn().mockResolvedValue(existingReceipts),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: pendingRows.length }),
      },
      automationContextObservation: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      automationShadowAggregate: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;
  }

  it('returns early with recorded: false and empty unmapped if current job receipt exists', async () => {
    const tx = createMockTx({ receiptExists: true });
    const result = await persistObservationBatch(tx, currentJob, p => p as ObservationJob);

    expect(result).toEqual({ recorded: false, unmapped: [] });
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('aggregates unmapped fields from current job when no pending siblings exist', async () => {
    const tx = createMockTx({ pendingRows: [] });
    const result = await persistObservationBatch(tx, currentJob, p => p as ObservationJob);

    expect(result.recorded).toBe(true);
    expect(result.unmapped).toEqual([{ key: 'env', type: 'ENUM' }]);
  });

  it('aggregates unmapped fields across current job and all batched sibling jobs', async () => {
    const pendingRows = [
      { id: 'job-sibling-1', payload: siblingJob1 },
      { id: 'job-sibling-2', payload: siblingJob2 },
    ];
    const tx = createMockTx({ pendingRows });
    const result = await persistObservationBatch(tx, currentJob, p => p as ObservationJob);

    expect(result.recorded).toBe(true);
    // current has 'env', sibling 1 has 'region' and 'cluster', sibling 2 has 'custom_flag'
    expect(result.unmapped).toEqual([
      { key: 'env', type: 'ENUM' },
      { key: 'region', type: 'STRING' },
      { key: 'cluster', type: 'STRING' },
      { key: 'custom_flag', type: 'BOOLEAN' },
    ]);
  });

  it('filters out siblings whose receipts already exist and excludes their unmapped metrics', async () => {
    // If sibling 1 was already completed by another thread/transaction
    const { createHash } = await import('crypto');
    const sibling1Receipt = `AUTOMATION_OBSERVATION_RECEIPT:${createHash('sha256')
      .update(JSON.stringify(siblingJob1))
      .digest('hex')}`;

    const pendingRows = [
      { id: 'job-sibling-1', payload: siblingJob1 },
      { id: 'job-sibling-2', payload: siblingJob2 },
    ];
    const tx = createMockTx({
      pendingRows,
      existingReceipts: [{ id: sibling1Receipt }],
    });
    const result = await persistObservationBatch(tx, currentJob, p => p as ObservationJob);

    expect(result.recorded).toBe(true);
    // Only current ('env') and sibling 2 ('custom_flag') are included; sibling 1 was filtered out
    expect(result.unmapped).toEqual([
      { key: 'env', type: 'ENUM' },
      { key: 'custom_flag', type: 'BOOLEAN' },
    ]);
  });
});
