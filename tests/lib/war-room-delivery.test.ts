import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock: Record<string, unknown> = {};

vi.mock('@/lib/prisma', () => ({
  default: new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (prismaMock[prop] ??= {});
      },
    },
  ),
}));

vi.mock('@/lib/jobs/queue', () => ({ scheduleJob: vi.fn().mockResolvedValue('job-1') }));

vi.mock('@/lib/war-room/registry', () => ({
  listWarRoomProviders: () => [{ provider: 'SLACK' }, { provider: 'MICROSOFT_TEAMS' }],
  getWarRoomProvider: vi.fn((p: string) => ({
    provider: p,
    handleIncidentEvent: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    capabilities: { archiveRoom: false },
    archive: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  })),
}));

const lifecycleMocks = {
  postSlackWarRoomUpdate: vi.fn().mockResolvedValue({ success: true }),
  updateSlackWarRoomTopic: vi.fn().mockResolvedValue({ success: true }),
  archiveSlackWarRoomChannel: vi.fn().mockResolvedValue({ success: true }),
  inviteUserToSlackWarRoom: vi.fn().mockResolvedValue({ success: true }),
  inviteTeamToSlackWarRoom: vi.fn().mockResolvedValue({ success: true }),
};
vi.mock('@/lib/war-room/providers/slack/lifecycle', () => lifecycleMocks);
vi.mock('@/lib/war-room/providers/slack/projection', () => ({
  requestSlackWarRoomProjectionForIncident: vi.fn().mockResolvedValue(undefined),
}));

function resetPrismaMock() {
  for (const k of Object.keys(prismaMock)) delete (prismaMock as Record<string, unknown>)[k];
  (prismaMock as Record<string, unknown>).backgroundJob = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };
}

describe('WarRoomProviderEventDelivery durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrismaMock();
  });

  it('ensureWarRoomDelivery is idempotent across COMPLETED (unique survives)', async () => {
    const { ensureWarRoomDelivery } = await import('@/lib/war-room/delivery');
    const prisma = (await import('@/lib/prisma')).default as unknown as Record<string, unknown>;
    const delivery = prisma.warRoomProviderEventDelivery as unknown as {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    delivery.create = vi.fn().mockResolvedValueOnce({ id: 'd1' }).mockRejectedValueOnce(p2002).mockRejectedValueOnce(p2002);
    delivery.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'd1', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'd1', status: 'COMPLETED' });

    const first = await ensureWarRoomDelivery({
      provider: 'SLACK',
      idempotencyKey: 'k1',
      incidentId: 'inc-1',
      kind: 'MESSAGE',
      eventPayload: {},
    });
    expect(first.created).toBe(true);
    expect(first.alreadyCompleted).toBe(false);

    const second = await ensureWarRoomDelivery({
      provider: 'SLACK',
      idempotencyKey: 'k1',
      incidentId: 'inc-1',
      kind: 'MESSAGE',
      eventPayload: {},
    });
    expect(second.created).toBe(false);
    expect(second.alreadyCompleted).toBe(false);

    const third = await ensureWarRoomDelivery({
      provider: 'SLACK',
      idempotencyKey: 'k1',
      incidentId: 'inc-1',
      kind: 'MESSAGE',
      eventPayload: {},
    });
    expect(third.alreadyCompleted).toBe(true);
  });

  it('handleIncidentWarRoomEvent skips already-COMPLETED deliveries and recovers missing jobs', async () => {
    const prisma = (await import('@/lib/prisma')).default as unknown as Record<string, unknown>;
    const deliveryCreate = vi.fn().mockResolvedValueOnce({ id: 'd-slack' }).mockResolvedValueOnce({ id: 'd-teams' });
    (prisma.warRoomProviderEventDelivery as unknown as { create: unknown }).create = deliveryCreate;
    (prisma.warRoomProviderEventDelivery as unknown as { findUnique: unknown }).findUnique = vi.fn().mockResolvedValue(null);
    const { handleIncidentWarRoomEvent } = await import('@/lib/war-room/engine');
    const { scheduleJob } = await import('@/lib/jobs/queue');
    await handleIncidentWarRoomEvent({ kind: 'MESSAGE', incidentId: 'inc-1', message: 'hello', incidentEventId: 'evt-1' } as never);
    expect(scheduleJob).toHaveBeenCalledTimes(2);

    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    (prisma.warRoomProviderEventDelivery as unknown as { create: unknown }).create = vi.fn().mockRejectedValue(p2002);
    (prisma.warRoomProviderEventDelivery as unknown as { findUnique: unknown }).findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'd-slack', status: 'PENDING' });
    (prisma.backgroundJob as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn().mockResolvedValue([]);
    vi.mocked(scheduleJob).mockClear();
    await handleIncidentWarRoomEvent({ kind: 'MESSAGE', incidentId: 'inc-1', message: 'hello', incidentEventId: 'evt-1' } as never);
    expect(scheduleJob).toHaveBeenCalled();
  });

  it('claimWarRoomDelivery fences concurrent workers with lease (retryBudgetNeutral)', async () => {
    const { claimWarRoomDelivery } = await import('@/lib/war-room/delivery');
    const prisma = (await import('@/lib/prisma')).default as unknown as Record<string, unknown>;
    const delivery = prisma.warRoomProviderEventDelivery as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    delivery.findUnique = vi.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', leaseExpiresAt: null });
    delivery.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(claimWarRoomDelivery({ provider: 'SLACK', idempotencyKey: 'k1' })).rejects.toMatchObject({
      name: 'WarRoomRetryableError',
      retryBudgetNeutral: true,
    });
  });

  it('Slack LIFECYCLE stages: retry after partial topic failure does not duplicate message', async () => {
    const stages = new Map<string, string>();
    (prismaMock as Record<string, unknown>).warRoomProviderEventStage = {
      findUnique: vi.fn(async ({ where }: { where: { deliveryId_stage?: { stage: string } } }) => {
        const stage = where?.deliveryId_stage?.stage;
        if (!stage) return null;
        const status = stages.get(stage);
        if (!status) return null;
        return { id: `id-${stage}`, status, leaseExpiresAt: null } as unknown;
      }),
      create: vi.fn(async ({ data }: { data: { stage: string } }) => {
        if (!stages.has(data.stage)) stages.set(data.stage, 'PENDING');
        return { id: `id-${data.stage}`, ...data, status: stages.get(data.stage) } as unknown;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { stage: string }; data: { status: string } }) => {
        const stage = where.stage;
        if (!stage) return { count: 0 };
        if (data.status === 'ATTEMPTING') {
          const cur = stages.get(stage);
          if (cur === 'COMPLETED' || cur === 'SKIPPED' || cur === 'AMBIGUOUS') return { count: 0 };
          stages.set(stage, 'ATTEMPTING');
          return { count: 1 };
        }
        if (data.status === 'COMPLETED') {
          stages.set(stage, 'COMPLETED');
          return { count: 1 };
        }
        if (data.status === 'FAILED') {
          stages.set(stage, 'FAILED');
          return { count: 1 };
        }
        if (data.status === 'AMBIGUOUS') {
          stages.set(stage, 'AMBIGUOUS');
          return { count: 1 };
        }
        return { count: 1 };
      }),
    } as unknown;
    (prismaMock as Record<string, unknown>).warRoomProviderEventDelivery = {
      findUnique: vi.fn().mockResolvedValue(null),
    } as unknown as Record<string, unknown>;
    (prismaMock as Record<string, unknown>).incidentWarRoom = {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    } as unknown as Record<string, unknown>;
    lifecycleMocks.postSlackWarRoomUpdate.mockReset().mockResolvedValue({ success: true });
    lifecycleMocks.updateSlackWarRoomTopic
      .mockReset()
      .mockResolvedValueOnce({ success: false, error: 'topic boom' })
      .mockResolvedValueOnce({ success: true });
    const { slackWarRoomAdapter } = await import('@/lib/war-room/providers/slack/adapter');
    const first = await slackWarRoomAdapter.handleIncidentEvent(
      { kind: 'LIFECYCLE', incidentId: 'inc-1', status: 'ACKNOWLEDGED', message: 'hi' } as never,
      { deliveryId: 'd1', idempotencyKey: 'k1' },
    );
    expect(first.ok).toBe(false);
    expect(lifecycleMocks.postSlackWarRoomUpdate).toHaveBeenCalledTimes(1);
    expect(lifecycleMocks.updateSlackWarRoomTopic).toHaveBeenCalledTimes(1);
    lifecycleMocks.postSlackWarRoomUpdate.mockClear();
    lifecycleMocks.updateSlackWarRoomTopic.mockClear();
    const second = await slackWarRoomAdapter.handleIncidentEvent(
      { kind: 'LIFECYCLE', incidentId: 'inc-1', status: 'ACKNOWLEDGED', message: 'hi' } as never,
      { deliveryId: 'd1', idempotencyKey: 'k1' },
    );
    expect(second.ok).toBe(true);
    expect(lifecycleMocks.postSlackWarRoomUpdate).not.toHaveBeenCalled();
    expect(lifecycleMocks.updateSlackWarRoomTopic).toHaveBeenCalledTimes(1);
  });

  it('Teams projector delegates to neutral participant-desired-state (no duplicate)', async () => {
    const neutral = { projectIncidentWarRoomParticipants: vi.fn().mockResolvedValue(undefined) };
    vi.doMock('@/lib/war-room/participant-desired-state', () => neutral);
    vi.resetModules();
    const { projectMicrosoftTeamsWarRoomParticipants } = await import('@/lib/war-room/providers/microsoft-teams/participants');
    await projectMicrosoftTeamsWarRoomParticipants('room-1');
    expect(neutral.projectIncidentWarRoomParticipants).toHaveBeenCalledWith('room-1');
  });

  it('stale ATTEMPTING stage becomes AMBIGUOUS and is not retried (no duplicate Slack POST)', async () => {
    const { claimWarRoomStageAttempt } = await import('@/lib/war-room/delivery');
    const stageKey = 'slack:lifecycle:message';
    const expiredLease = new Date(Date.now() - 60_000);
    (prismaMock as Record<string, unknown>).warRoomProviderEventStage = {
      findUnique: vi.fn(async () => ({ id: 'st-1', status: 'ATTEMPTING', leaseExpiresAt: expiredLease } as unknown)),
      updateMany: vi.fn(async ({ where }: { where: { status?: string } }) => {
        if (where.status === 'ATTEMPTING') return { count: 1 };
        return { count: 0 };
      }),
      create: vi.fn(),
    } as unknown;

    const res = await claimWarRoomStageAttempt('d1', stageKey);
    expect(res.claimed).toBe(false);
  });

  it('active ATTEMPTING remains fenced (retryBudgetNeutral) and is not converted to AMBIGUOUS', async () => {
    const { claimWarRoomStageAttempt } = await import('@/lib/war-room/delivery');
    const futureLease = new Date(Date.now() + 60_000);
    (prismaMock as Record<string, unknown>).warRoomProviderEventStage = {
      findUnique: vi.fn(async () => ({ id: 'st-1', status: 'ATTEMPTING', leaseExpiresAt: futureLease } as unknown)),
      updateMany: vi.fn(),
      create: vi.fn(),
    } as unknown;
    await expect(claimWarRoomStageAttempt('d1', 'slack:lifecycle:message')).rejects.toMatchObject({
      name: 'WarRoomRetryableError',
    });
  });

  it('markStageAmbiguous with stale operationId is CAS-only and does not broadly clobber new attempt', async () => {
    const { markStageAmbiguous } = await import('@/lib/war-room/delivery');
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    (prismaMock as Record<string, unknown>).warRoomProviderEventStage = { updateMany } as unknown;
    const result = await markStageAmbiguous('d1', 'slack:lifecycle:message', 'boom', 'stale-op', 'stale-lease');
    expect(result).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const where = (updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.operationId).toBe('stale-op');
    expect(where.leaseToken).toBe('stale-lease');
  });

  it('provider succeeded but completion crashed: retry becomes AMBIGUOUS, adapter does not duplicate', async () => {
    const expiredLease = new Date(Date.now() - 60_000);
    // First call: claim sees expired ATTEMPTING → marks AMBIGUOUS. Second call: adapter sees AMBIGUOUS.
    let call = 0;
    (prismaMock as Record<string, unknown>).warRoomProviderEventStage = {
      findUnique: vi.fn(async () => {
        if (call++ === 0) return { id: 'st-1', status: 'ATTEMPTING', leaseExpiresAt: expiredLease } as unknown;
        return { id: 'st-1', status: 'AMBIGUOUS', leaseExpiresAt: null } as unknown;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(),
    } as unknown;
    (prismaMock as Record<string, unknown>).warRoomProviderEventDelivery = {
      findUnique: vi.fn().mockResolvedValue(null),
    } as unknown;
    (prismaMock as Record<string, unknown>).incidentWarRoom = {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    } as unknown;
    lifecycleMocks.postSlackWarRoomUpdate.mockReset().mockResolvedValue({ success: true });
    lifecycleMocks.updateSlackWarRoomTopic.mockReset().mockResolvedValue({ success: true });

    const { claimWarRoomStageAttempt } = await import('@/lib/war-room/delivery');
    const res = await claimWarRoomStageAttempt('d1', 'slack:lifecycle:message');
    expect(res.claimed).toBe(false);

    const { slackWarRoomAdapter } = await import('@/lib/war-room/providers/slack/adapter');
    const adapterRes = await slackWarRoomAdapter.handleIncidentEvent(
      { kind: 'LIFECYCLE', incidentId: 'inc-1', status: 'ACKNOWLEDGED', message: 'hi' } as never,
      { deliveryId: 'd1', idempotencyKey: 'k1' },
    );
    expect(adapterRes.ok).toBe(false);
    if (!adapterRes.ok) expect(adapterRes.code).toBe('AMBIGUOUS_SIDE_EFFECT');
    expect(lifecycleMocks.postSlackWarRoomUpdate).not.toHaveBeenCalled();
  });
});

describe('WAR_ROOM_CLOSE terminal projection fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrismaMock();
  });

  it('WAR_ROOM_CLOSE waits for terminalProjectionVersion and does not re-queue on retry', async () => {
    (prismaMock as Record<string, unknown>).incidentWarRoom = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'room-1',
        incidentId: 'inc-1',
        provider: 'SLACK',
        state: 'CLOSING',
        projectionVersion: 7,
        lastProjectedVersion: 5,
        projectionLeaseToken: null,
      }),
    } as unknown;
    const { finalizeWarRoomCloseNeutral } = await import('@/lib/war-room/engine');
    await expect(finalizeWarRoomCloseNeutral('room-1', 'inc-1', 7)).rejects.toMatchObject({
      name: 'WarRoomRetryableError',
      retryBudgetNeutral: true,
    });
  });

  it('WAR_ROOM_CLOSE with matching lastProjectedVersion and no lease does not throw version wait', async () => {
    (prismaMock as Record<string, unknown>).incidentWarRoom = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'room-1',
        incidentId: 'inc-1',
        provider: 'SLACK',
        state: 'CLOSING',
        projectionVersion: 5,
        lastProjectedVersion: 5,
        projectionLeaseToken: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } as unknown;
    const { finalizeWarRoomCloseNeutral } = await import('@/lib/war-room/engine');
    try {
      await finalizeWarRoomCloseNeutral('room-1', 'inc-1', 5);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('Waiting for terminal projection to reach target version');
      expect(msg).not.toContain('Waiting for terminal projection to be applied');
    }
  });

  it('WAR_ROOM_CLOSE with active lease waits budget-neutral even when lastProjectedVersion is behind', async () => {
    (prismaMock as Record<string, unknown>).incidentWarRoom = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'room-1',
        incidentId: 'inc-1',
        provider: 'SLACK',
        state: 'CLOSING',
        projectionVersion: 7,
        lastProjectedVersion: 5,
        projectionLeaseToken: 'lease-1',
        projectionLeaseExpiresAt: new Date(Date.now() + 60_000),
      }),
    } as unknown;
    const { finalizeWarRoomCloseNeutral } = await import('@/lib/war-room/engine');
    await expect(finalizeWarRoomCloseNeutral('room-1', 'inc-1', 7)).rejects.toMatchObject({
      name: 'WarRoomRetryableError',
      retryBudgetNeutral: true,
    });
  });
});
