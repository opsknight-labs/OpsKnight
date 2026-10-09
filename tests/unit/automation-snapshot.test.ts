import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ESCALATION_STEPS,
  MAX_RESPONDER_SNAPSHOT_BYTES,
  responderSnapshotSchema,
  captureResponderSnapshot,
} from '@/lib/escalation/automation-snapshot';
import { validateReferences } from '@/lib/automation/versioning';
import type { CompiledSnapshot } from '@/lib/automation/contract';
import type { Prisma } from '@prisma/client';

describe('responderSnapshotSchema and captureResponderSnapshot bounds', () => {
  const validStep = (order: number) => ({
    id: `step-${order}`,
    policyId: 'pol-1',
    delayMinutes: 5,
    stepOrder: order,
    targetType: 'USER' as const,
    targetUserId: 'user-1',
    targetTeamId: null,
    targetScheduleId: null,
    notificationChannels: ['EMAIL' as const],
    notifyOnlyTeamLead: false,
    conditions: [
      {
        field: 'PRIORITY' as const,
        operator: 'IN' as const,
        values: ['P1', 'P2'],
      },
    ],
  });

  it('accepts valid policy with within-limit steps and strict condition schema', () => {
    const policy = {
      id: 'pol-1',
      name: 'Engineering Escalation',
      steps: [validStep(0), validStep(1)],
    };

    const parsed = responderSnapshotSchema.safeParse(policy);
    expect(parsed.success).toBe(true);
  });

  it('rejects policy exceeding MAX_ESCALATION_STEPS (50 steps)', () => {
    const steps = Array.from({ length: 51 }, (_, i) => validStep(i));
    const policy = {
      id: 'pol-1',
      name: 'Bloated Escalation Policy',
      steps,
    };

    const parsed = responderSnapshotSchema.safeParse(policy);
    expect(parsed.success).toBe(false);
  });

  it('rejects steps with invalid conditions under escalationConditionSchema', () => {
    const policy = {
      id: 'pol-1',
      name: 'Invalid Condition Policy',
      steps: [
        {
          ...validStep(0),
          conditions: [
            {
              field: 'UNKNOWN_FIELD',
              operator: 'EQUALS',
              values: ['P1'],
            },
          ],
        },
      ],
    };

    const parsed = responderSnapshotSchema.safeParse(policy);
    expect(parsed.success).toBe(false);
  });

  it('captureResponderSnapshot enforces MAX_ESCALATION_STEPS', async () => {
    const mockTx = {
      escalationPolicy: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'pol-oversized',
          name: 'Oversized Policy',
          steps: Array.from({ length: 51 }, (_, i) => validStep(i)),
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(captureResponderSnapshot(mockTx, 'pol-oversized')).rejects.toThrow(
      `Pinned escalation policy exceeds maximum step limit of ${MAX_ESCALATION_STEPS}`
    );
  });

  it('captureResponderSnapshot enforces MAX_RESPONDER_SNAPSHOT_BYTES (64KB)', async () => {
    // 40 steps, but with massive names or IDs that blow past 65,536 bytes
    const largeName = 'A'.repeat(70_000);
    const mockTx = {
      escalationPolicy: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'pol-large',
          name: largeName,
          steps: [validStep(0)],
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(captureResponderSnapshot(mockTx, 'pol-large')).rejects.toThrow(
      `Pinned escalation policy snapshot exceeds byte size limit of ${MAX_RESPONDER_SNAPSHOT_BYTES} bytes`
    );
  });

  it('validateReferences blocks publishing when referenced policy exceeds MAX_ESCALATION_STEPS', async () => {
    const mockTx = {
      escalationPolicy: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pol-too-many-steps',
            name: 'Policy With 60 Steps',
            _count: { steps: 60 },
          },
        ]),
      },
      slackDestination: { findFirst: vi.fn() },
      microsoftTeamsDestination: { findFirst: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    const compiled: CompiledSnapshot = {
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'rule-1',
          name: 'Route rule',
          phase: 'ROUTE',
          enabled: true,
          conditions: [],
          actions: [
            {
              type: 'USE_ESCALATION_POLICY',
              policyId: 'pol-too-many-steps',
            },
          ],
        },
      ],
    };

    await expect(validateReferences(mockTx, 'srv-1', compiled)).rejects.toThrow(
      `Referenced escalation policy "Policy With 60 Steps" exceeds maximum step limit of ${MAX_ESCALATION_STEPS}`
    );
  });
  it('publication validates the complete responder snapshot byte size, not only step count', async () => {
    const tx = {
      escalationPolicy: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'large', name: 'Large policy', _count: { steps: 0 } }]),
        findUnique: vi.fn().mockResolvedValue({ id: 'large', name: 'x'.repeat(70000), steps: [] }),
      },
    } as unknown as Prisma.TransactionClient;
    const compiled = {
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'route',
          name: 'Route',
          phase: 'ROUTE',
          enabled: true,
          conditions: [],
          actions: [{ type: 'USE_ESCALATION_POLICY', policyId: 'large' }],
        },
      ],
    } as CompiledSnapshot;
    await expect(validateReferences(tx, 'service', compiled)).rejects.toThrow('byte size limit');
  });
});
