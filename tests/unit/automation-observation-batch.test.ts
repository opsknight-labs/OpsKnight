import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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
      {
        key: 'severity',
        path: 'detail.severity',
        value: 'critical',
        type: 'STRING',
        unmapped: false,
      },
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
      systemSettings: {
        findUnique: vi.fn().mockResolvedValue({ automationStoreObservationPreviews: false }),
      },
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
      .update(JSON.stringify([siblingJob1.serviceId, siblingJob1.logicalKey]))
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

  it('persists source provenance column for PROVIDER and EVENT observations into database', async () => {
    const jobWithSources: ObservationJob = {
      task: 'AUTOMATION_OBSERVE',
      logicalKey: 'job-sources',
      serviceId: 'srv-1',
      integrationId: 'int-gh-1',
      integrationType: 'GITHUB',
      observations: [
        {
          key: 'status',
          path: 'status',
          value: 'open',
          type: 'STRING',
          unmapped: false,
          source: 'EVENT',
        },
        {
          key: 'status',
          path: 'status',
          value: 'closed',
          type: 'STRING',
          unmapped: true,
          source: 'PROVIDER',
        },
      ],
    };

    const tx = createMockTx({ pendingRows: [] });
    const result = await persistObservationBatch(tx, jobWithSources, p => p as ObservationJob);

    expect(result.recorded).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();

    const calls = vi.mocked(tx.$executeRaw).mock.calls;
    const insertCall = calls.find(call => {
      const sqlObj = call[0] as unknown as { strings: string[]; values: unknown[] };
      return sqlObj?.strings?.some(s => s.includes('INSERT INTO "AutomationContextObservation"'));
    });
    expect(insertCall).toBeDefined();
    const sql = insertCall![0] as unknown as { strings: string[]; values: unknown[] };
    expect(sql.strings.join('')).toContain('"source"');
    expect(sql.strings.join('')).toContain(
      'ON CONFLICT ("serviceId", "integrationId", "fieldKey", "sourcePath", "normalizedRawValueHash", "source")'
    );
    expect(sql.values).toContain('EVENT');
    expect(sql.values).toContain('PROVIDER');
  });

  it('deduplicates and preserves distinct observations when key, path, and value are identical across EVENT and PROVIDER sources', async () => {
    const jobWithIdenticalKeyValue: ObservationJob = {
      task: 'AUTOMATION_OBSERVE',
      logicalKey: 'job-identical-key-value',
      serviceId: 'srv-1',
      integrationId: 'int-gh-1',
      integrationType: 'GITHUB',
      observations: [
        {
          key: 'status',
          path: 'status',
          value: 'open',
          type: 'STRING',
          unmapped: false,
          source: 'EVENT',
        },
        {
          key: 'status',
          path: 'status',
          value: 'open',
          type: 'STRING',
          unmapped: false,
          source: 'PROVIDER',
        },
      ],
    };

    const tx = createMockTx({ pendingRows: [] });
    const result = await persistObservationBatch(
      tx,
      jobWithIdenticalKeyValue,
      p => p as ObservationJob
    );

    expect(result.recorded).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();

    const calls = vi.mocked(tx.$executeRaw).mock.calls;
    const insertCall = calls.find(call => {
      const sqlObj = call[0] as unknown as { strings: string[]; values: unknown[] };
      return sqlObj?.strings?.some(s => s.includes('INSERT INTO "AutomationContextObservation"'));
    });
    expect(insertCall).toBeDefined();
    const sql = insertCall![0] as unknown as { strings: string[]; values: unknown[] };
    expect(sql.strings.join('')).toContain(
      'ON CONFLICT ("serviceId", "integrationId", "fieldKey", "sourcePath", "normalizedRawValueHash", "source")'
    );
    // Both observations must be inserted as separate rows (12 params each = 24) rather than collapsing into one
    expect(sql.values).toHaveLength(24);
    expect(sql.values).toContain('EVENT');
    expect(sql.values).toContain('PROVIDER');
    expect(sql.values).not.toContain('open');
    expect(sql.values.filter(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))).toHaveLength(2);
    expect(sql.values.filter(v => v === 'status')).toHaveLength(4);
  });

  it('preserves null source for historical observations without coercing into EVENT or PROVIDER', async () => {
    const job: ObservationJob = {
      task: 'AUTOMATION_OBSERVE',
      logicalKey: 'job-historical-compat',
      serviceId: 'srv-1',
      integrationId: 'int-cw-1',
      integrationType: 'CLOUDWATCH',
      observations: [
        {
          key: 'status',
          path: 'detail.status',
          value: 'open',
          type: 'STRING',
          unmapped: false,
          source: 'EVENT',
        },
      ],
    };

    const hash = createHash('sha256').update('open').digest('hex');
    const tx = createMockTx({ pendingRows: [] });
    // Simulate historical observation row in DB with source: null
    vi.mocked(tx.automationContextObservation.findMany).mockResolvedValueOnce([
      {
        id: 'obs-old-1',
        serviceId: 'srv-1',
        integrationId: 'int-cw-1',
        integrationType: 'CLOUDWATCH',
        fieldType: 'STRING',
        rawValuePreview: 'open',
        unmapped: false,
        count: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        fieldKey: 'status',
        sourcePath: 'detail.status',
        source: null,
        normalizedRawValueHash: hash,
      },
    ]);

    const result = await persistObservationBatch(tx, job, p => p as ObservationJob);
    expect(result.recorded).toBe(true);

    const calls = vi.mocked(tx.$executeRaw).mock.calls;
    const insertCall = calls.find(call => {
      const sqlObj = call[0] as unknown as { strings: string[]; values: unknown[] };
      return sqlObj?.strings?.some(s => s.includes('INSERT INTO "AutomationContextObservation"'));
    });
    expect(insertCall).toBeDefined();
    const sql = insertCall![0] as unknown as { strings: string[]; values: unknown[] };
    expect(sql.values).toContain('EVENT');
    expect(sql.strings.join('')).toContain(
      'ON CONFLICT ("serviceId", "integrationId", "fieldKey", "sourcePath", "normalizedRawValueHash", "source")'
    );
  });
});
