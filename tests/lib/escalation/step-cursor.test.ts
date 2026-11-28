import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  countOpenIncidentsMidEscalation,
  matchReplacementSteps,
  readEscalationStepOrder,
  remapEscalationCursor,
  remapOpenIncidentEscalationCursors,
} from '@/lib/escalation/step-cursor';

describe('remapEscalationCursor', () => {
  const A = 'A';
  const B = 'B';
  const C = 'C';
  const D = 'D';

  it('moves the cursor down when a tier before it is deleted', () => {
    // Next tier is C (index 2); deleting A must leave it on C, now at index 1.
    expect(remapEscalationCursor([A, B, C], [B, C], 2)).toBe(1);
    expect(remapEscalationCursor([A, B, C, D], [A, C, D], 3)).toBe(2);
  });

  it('leaves the cursor on the following tier when the tier it points at is deleted', () => {
    // B was next; C slides into index 1 and is paged next, not skipped.
    expect(remapEscalationCursor([A, B, C], [A, C], 1)).toBe(1);
  });

  it('runs the cursor off the end when the last unpaged tier is deleted', () => {
    // Nothing is left to page; the executor completes the escalation at index === length.
    expect(remapEscalationCursor([A, B, C], [A, B], 2)).toBe(2);
  });

  it('does not move the cursor when a later tier is deleted', () => {
    expect(remapEscalationCursor([A, B, C, D], [A, B, C], 1)).toBe(1);
    expect(remapEscalationCursor([A, B, C, D], [A, B, D], 2)).toBe(2);
  });

  it('handles several deletions at once', () => {
    expect(remapEscalationCursor([A, B, C, D], [B, D], 3)).toBe(1);
    expect(remapEscalationCursor([A, B, C, D], [D], 1)).toBe(0);
  });

  it('keeps the cursor when only unpaged tiers are reordered', () => {
    // A is paged and stays first; B, C, D are all still ahead in whatever order.
    expect(remapEscalationCursor([A, B, C, D], [A, D, C, B], 1)).toBe(1);
  });

  it('keeps the cursor when only paged tiers are reordered', () => {
    expect(remapEscalationCursor([A, B, C, D], [B, A, C, D], 2)).toBe(2);
  });

  it('keeps an unstarted escalation at the first tier', () => {
    expect(remapEscalationCursor([A, B, C], [C, B, A], 0)).toBe(0);
    expect(remapEscalationCursor([A, B, C], [B, C], 0)).toBe(0);
  });

  it('re-pages rather than skips when an unpaged tier moves above a paged one', () => {
    // A was paged and B is next. B now sits first, so the cursor must point at it;
    // A (already paged) comes round again because one cursor cannot say it was paged.
    expect(remapEscalationCursor([A, B, C], [B, A, C], 1)).toBe(0);
    expect(remapEscalationCursor([A, B, C, D], [A, C, B, D], 2)).toBe(1);
  });

  it('never skips an unpaged tier and pages none twice when the paged tiers stay in front', () => {
    const ids = ['A', 'B', 'C', 'D'];
    const arrangements = (items: string[]): string[][] =>
      items.length === 0
        ? [[]]
        : items.flatMap((item, index) =>
            arrangements([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [
              item,
              ...rest,
            ])
          );
    const subsets = ids.reduce<string[][]>(
      (all, id) => [...all, ...all.map(subset => [...subset, id])],
      [[]]
    );

    for (let cursor = 0; cursor <= ids.length; cursor += 1) {
      const paged = new Set(ids.slice(0, cursor));
      const unpaged = ids.slice(cursor);
      for (const subset of subsets) {
        for (const after of arrangements(subset)) {
          const next = remapEscalationCursor(ids, after, cursor);
          const willPage = after.slice(next);
          const pagedSurvivors = after.filter(id => paged.has(id));
          const unpagedSurvivors = after.filter(id => unpaged.includes(id));
          // No tier is ever skipped.
          expect([...willPage].filter(id => !paged.has(id)).sort()).toEqual(
            [...unpagedSurvivors].sort()
          );
          // When the paged tiers still lead the order, none is paged again.
          const pagedLead = after.slice(0, pagedSurvivors.length).every(id => paged.has(id));
          if (pagedLead) expect(willPage.filter(id => paged.has(id))).toEqual([]);
        }
      }
    }
  });
});

describe('remapOpenIncidentEscalationCursors', () => {
  function txMock(rows: Array<{ id: string; step: number }>) {
    return {
      $queryRaw: vi.fn().mockResolvedValue(rows),
      $executeRaw: vi.fn().mockResolvedValue(1),
      incident: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
      },
      backgroundJob: { create: vi.fn().mockResolvedValue({ id: 'job-new' }) },
      escalationRule: { findMany: vi.fn() },
    };
  }

  it('does nothing when the order did not change', async () => {
    const tx = txMock([{ id: 'inc-1', step: 1 }]);
    const moved = await remapOpenIncidentEscalationCursors(tx as unknown as Prisma.TransactionClient, {
      policyId: 'pol-1',
      before: ['A', 'B'],
      after: ['A', 'B'],
    });
    expect(moved).toBe(0);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('moves each in-flight incident and its queued job to the cursor that keeps its tier', async () => {
    const tx = txMock([
      { id: 'inc-late', step: 2 },
      { id: 'inc-late-2', step: 2 },
      { id: 'inc-mid', step: 1 },
      { id: 'inc-first', step: 0 },
    ]);
    const moved = await remapOpenIncidentEscalationCursors(tx as unknown as Prisma.TransactionClient, {
      policyId: 'pol-1',
      before: ['A', 'B', 'C'],
      after: ['B', 'C'],
    });

    // A is gone: C is next at 1, B is next at 0 (kept), and an unstarted incident stays at 0.
    expect(tx.incident.updateMany.mock.calls.map(call => call[0])).toEqual([
      {
        where: { id: { in: ['inc-late', 'inc-late-2'] } },
        data: { currentEscalationStep: 1, escalationProcessingAt: null },
      },
      {
        where: { id: { in: ['inc-mid'] } },
        data: { currentEscalationStep: 0, escalationProcessingAt: null },
      },
    ]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(moved).toBe(3);
  });

  it('releases the lease of an incident a worker had claimed and queues the moved step', async () => {
    const dueAt = new Date('2026-12-01T10:00:00.000Z');
    const tx = txMock([{ id: 'inc-claimed', step: 2 }]);
    // First read is the FOR UPDATE select; later reads are the job lookup (no job exists).
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'inc-claimed', step: 2 }]).mockResolvedValue([]);
    tx.incident.findMany.mockResolvedValue([
      { id: 'inc-claimed', escalationGeneration: 4, nextEscalationAt: dueAt },
    ]);
    // What the incident looks like once the cursor has moved: still escalating, due now.
    tx.incident.findUnique.mockResolvedValue({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
      escalationGeneration: 4,
      currentEscalationStep: 1,
      nextEscalationAt: dueAt,
    });

    await remapOpenIncidentEscalationCursors(tx as unknown as Prisma.TransactionClient, {
      policyId: 'pol-1',
      before: ['A', 'B', 'C'],
      after: ['B', 'C'],
    });

    expect(tx.incident.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['inc-claimed'] } },
      data: { currentEscalationStep: 1, escalationProcessingAt: null },
    });
    const created = tx.backgroundJob.create.mock.calls.map(
      call => call[0] as { data: { status: string; scheduledAt: Date; payload: Record<string, unknown> } }
    );
    expect(created).toHaveLength(1);
    expect(created[0].data).toMatchObject({
      status: 'PENDING',
      scheduledAt: dueAt,
      payload: { incidentId: 'inc-claimed', stepIndex: 1, generation: 4 },
    });
  });

  it('queues nothing for an incident no worker had claimed', async () => {
    const tx = txMock([{ id: 'inc-idle', step: 2 }]);
    await remapOpenIncidentEscalationCursors(tx as unknown as Prisma.TransactionClient, {
      policyId: 'pol-1',
      before: ['A', 'B', 'C'],
      after: ['B', 'C'],
    });
    expect(tx.backgroundJob.create).not.toHaveBeenCalled();
  });

  it('locks only open incidents that follow the live policy', async () => {
    const tx = txMock([]);
    await remapOpenIncidentEscalationCursors(tx as unknown as Prisma.TransactionClient, {
      policyId: 'pol-9',
      before: ['A', 'B'],
      after: ['B'],
    });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('?');
    expect(values).toEqual(['pol-9']);
    expect(sql).toContain('FOR UPDATE OF i');
    expect(sql).toContain(`d.mode::text <> 'LIVE'`);
    expect(sql).toContain(`i."escalationStatus" IN ('ESCALATING', 'PAUSED')`);
  });
});

describe('countOpenIncidentsMidEscalation', () => {
  const sqlOf = (mock: ReturnType<typeof vi.fn>) => {
    const [strings, ...values] = mock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    return { sql: strings.join('?'), values };
  };

  it('counts the open incidents on the policy', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ count: 4 }]) };
    await expect(countOpenIncidentsMidEscalation(db, 'pol-1')).resolves.toBe(4);
    expect(sqlOf(db.$queryRaw).values).toEqual(['pol-1']);
  });

  it('is zero when the policy has none', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ count: 0 }]) };
    await expect(countOpenIncidentsMidEscalation(db, 'pol-1')).resolves.toBe(0);
    const empty = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(countOpenIncidentsMidEscalation(empty, 'pol-1')).resolves.toBe(0);
  });

  it('uses the filter that remapOpenIncidentEscalationCursors moves, so the warning matches the move', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ count: 1 }]) };
    await countOpenIncidentsMidEscalation(db, 'pol-1');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn(),
      incident: { updateMany: vi.fn() },
    };
    await remapOpenIncidentEscalationCursors(tx as unknown as Prisma.TransactionClient, {
      policyId: 'pol-1',
      before: ['A', 'B'],
      after: ['B'],
    });

    const count = sqlOf(db.$queryRaw).sql;
    const remap = sqlOf(tx.$queryRaw).sql;
    const where = (sql: string) => sql.slice(sql.indexOf('WHERE')).replace(/\s*FOR UPDATE OF i\s*$/, '');
    expect(where(count).replace(/\s+/g, ' ').trim()).toBe(where(remap).replace(/\s+/g, ' ').trim());
    expect(count).toContain(`d.mode::text <> 'LIVE'`);
    expect(count).not.toContain('FOR UPDATE');
  });
});

describe('readEscalationStepOrder', () => {
  it('lists step ids in escalation order', async () => {
    const tx = { escalationRule: { findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) } };
    await expect(readEscalationStepOrder(tx as never, 'pol-1')).resolves.toEqual(['a', 'b']);
    expect(tx.escalationRule.findMany).toHaveBeenCalledWith({
      where: { policyId: 'pol-1' },
      orderBy: { stepOrder: 'asc' },
      select: { id: true },
    });
  });
});

describe('matchReplacementSteps', () => {
  const base = {
    targetType: 'USER',
    targetUserId: null,
    targetTeamId: null,
    targetScheduleId: null,
    notificationChannels: ['EMAIL', 'SMS'],
    notifyOnlyTeamLead: false,
  };
  const stored = [
    { id: 'r1', ...base, targetUserId: 'u1', conditions: [] },
    { id: 'r2', ...base, targetType: 'TEAM', targetTeamId: 't1', conditions: [] },
    {
      id: 'r3',
      ...base,
      targetUserId: 'u3',
      conditions: [{ field: 'PRIORITY', operator: 'IN', values: ['P2', 'P1'] }],
    },
  ];

  it('maps a pure delete or reorder to the stored step ids', () => {
    expect(
      matchReplacementSteps(stored, [
        { ...base, targetUserId: 'u3', conditions: [{ field: 'PRIORITY', operator: 'IN', values: ['P1', 'P2'] }] },
        { ...base, targetUserId: 'u1' },
      ])
    ).toEqual(['r3', 'r1']);
  });

  it('ignores channel order and delay', () => {
    expect(
      matchReplacementSteps(stored, [{ ...base, targetUserId: 'u1', notificationChannels: ['SMS', 'EMAIL'] }])
    ).toEqual(['r1']);
  });

  it('gives up when a replacement step is an edit or an insert', () => {
    expect(matchReplacementSteps(stored, [{ ...base, targetUserId: 'someone-else' }])).toBeNull();
    expect(
      matchReplacementSteps(stored, [{ ...base, targetUserId: 'u1', notifyOnlyTeamLead: true }])
    ).toBeNull();
  });

  it('never matches one stored step twice', () => {
    expect(
      matchReplacementSteps(stored, [
        { ...base, targetUserId: 'u1' },
        { ...base, targetUserId: 'u1' },
      ])
    ).toBeNull();
  });
});
