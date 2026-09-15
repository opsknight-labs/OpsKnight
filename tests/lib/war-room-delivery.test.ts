import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock: Record<string, unknown> = {};

vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, {
    get(_t, prop: string) {
      return (prismaMock[prop] ??= {});
    },
  }),
}));

vi.mock('@/lib/jobs/queue', () => ({ scheduleJob: vi.fn().mockResolvedValue('job-1') }));

vi.mock('@/lib/war-room/registry', () => ({
  listWarRoomProviders: () => [{ provider: 'SLACK' }, { provider: 'MICROSOFT_TEAMS' }],
  getWarRoomProvider: vi.fn((p: string) => ({
    provider: p,
    handleIncidentEvent: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  })),
}));

describe('WarRoomProviderEventDelivery durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(prismaMock)) delete (prismaMock as Record<string, unknown>)[k];
    // default backgroundJob mocks
    (prismaMock as Record<string, unknown>).backgroundJob = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'job-1' }),
    };
  });

  it('ensureWarRoomDelivery is idempotent across COMPLETED (unique survives)', async () => {
    const { ensureWarRoomDelivery } = await import('@/lib/war-room/delivery');
    const prisma = (await import('@/lib/prisma')).default as unknown as Record<string, unknown>;
    const delivery = prisma.warRoomProviderEventDelivery as Record<string, unknown> as { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    delivery.create = vi.fn()
      .mockResolvedValueOnce({ id: 'd1' })
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002);
    delivery.findUnique = vi.fn()
      .mockResolvedValueOnce({ id: 'd1', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'd1', status: 'COMPLETED' });

    const first = await ensureWarRoomDelivery({ provider: 'SLACK', idempotencyKey: 'k1', incidentId: 'inc-1', kind: 'MESSAGE', eventPayload: {} });
    expect(first.created).toBe(true);
    expect(first.alreadyCompleted).toBe(false);

    const second = await ensureWarRoomDelivery({ provider: 'SLACK', idempotencyKey: 'k1', incidentId: 'inc-1', kind: 'MESSAGE', eventPayload: {} });
    expect(second.created).toBe(false);
    expect(second.alreadyCompleted).toBe(false);

    const third = await ensureWarRoomDelivery({ provider: 'SLACK', idempotencyKey: 'k1', incidentId: 'inc-1', kind: 'MESSAGE', eventPayload: {} });
    expect(third.alreadyCompleted).toBe(true);
  });

  it('handleIncidentWarRoomEvent skips already-COMPLETED deliveries and recovers missing jobs', async () => {
    const prisma = (await import('@/lib/prisma')).default as unknown as Record<string, unknown>;
    const deliveryCreate = vi.fn()
      .mockResolvedValueOnce({ id: 'd-slack' })
      .mockResolvedValueOnce({ id: 'd-teams' });
    // First call: both providers create fresh
    (prisma.warRoomProviderEventDelivery as unknown as { create: unknown }).create = deliveryCreate;
    (prisma.warRoomProviderEventDelivery as unknown as { findUnique: unknown }).findUnique = vi.fn().mockResolvedValue(null);
    const { handleIncidentWarRoomEvent } = await import('@/lib/war-room/engine');
    const { scheduleJob } = await import('@/lib/jobs/queue');
    await handleIncidentWarRoomEvent({ kind: 'MESSAGE', incidentId: 'inc-1', message: 'hello', incidentEventId: 'evt-1' } as never);
    expect(scheduleJob).toHaveBeenCalledTimes(2);

    // Second call with same incidentEventId -> delivery returns alreadyCompleted for SLACK, so only Teams remains? Actually both already exist.
    // Simulate crash: delivery exists PENDING but no BackgroundJob (worker crashed before schedule). Second fan-out must recover by scheduling.
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    (prisma.warRoomProviderEventDelivery as unknown as { create: unknown }).create = vi.fn().mockRejectedValue(p2002);
    (prisma.warRoomProviderEventDelivery as unknown as { findUnique: unknown }).findUnique = vi.fn().mockResolvedValue({ id: 'd-slack', status: 'PENDING' });
    (prisma.backgroundJob as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn().mockResolvedValue([]);
    vi.mocked(scheduleJob).mockClear();
    await handleIncidentWarRoomEvent({ kind: 'MESSAGE', incidentId: 'inc-1', message: 'hello', incidentEventId: 'evt-1' } as never);
    // Should have scheduled recovery job for SLACK (and TEAMS) since no pending job found
    expect(scheduleJob).toHaveBeenCalled();
  });

  it('claimWarRoomDelivery fences concurrent workers with lease (retryBudgetNeutral)', async () => {
    const { claimWarRoomDelivery } = await import('@/lib/war-room/delivery');
    const prisma = (await import('@/lib/prisma')).default as unknown as Record<string, unknown>;
    const delivery = prisma.warRoomProviderEventDelivery as unknown as { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    delivery.findUnique = vi.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', leaseExpiresAt: null });
    delivery.updateMany = vi.fn().mockResolvedValue({ count: 0 }); // CAS fenced
    await expect(claimWarRoomDelivery({ provider: 'SLACK', idempotencyKey: 'k1' })).rejects.toMatchObject({ name: 'WarRoomRetryableError', retryBudgetNeutral: true });
  });

  it('Slack LIFECYCLE stages: retry after partial topic failure does not duplicate message', async () => {
    // Mock lifecycle to simulate message ok, topic fail on first attempt
    const lifecycleMock = {
      postSlackWarRoomUpdate: vi.fn().mockResolvedValue({ success: true }),
      updateSlackWarRoomTopic: vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'topic boom' })
        .mockResolvedValueOnce({ success: true }),
      archiveSlackWarRoomChannel: vi.fn(),
      inviteUserToSlackWarRoom: vi.fn(),
      inviteTeamToSlackWarRoom: vi.fn(),
    };
    vi.doMock('@/lib/war-room/providers/slack/lifecycle', () => lifecycleMock);
    // Mock delivery stage storage
    const stages = new Map<string, string>(); // key -> status
    vi.doMock('@/lib/war-room/delivery', async () => {
      const actual = await vi.importActual('@/lib/war-room/delivery') as Record<string, unknown>;
      return {
        ...actual,
        stageAlreadyCompleted: vi.fn(async (_id: string, stage: string) => stages.get(stage) === 'COMPLETED'),
        ensureWarRoomStage: vi.fn(async (_id: string, stage: string) => { if (!stages.has(stage)) stages.set(stage, 'PENDING'); }),
        completeWarRoomStage: vi.fn(async (_id: string, stage: string) => stages.set(stage, 'COMPLETED')),
        failWarRoomStage: vi.fn(async (_id: string, stage: string) => stages.set(stage, 'FAILED')),
      };
    });
    const { slackWarRoomAdapter } = await import('@/lib/war-room/providers/slack/adapter');
    // First attempt: message succeeds, topic fails
    const first = await slackWarRoomAdapter.handleIncidentEvent({ kind: 'LIFECYCLE', incidentId: 'inc-1', status: 'ACKNOWLEDGED', message: 'hi' } as never, { deliveryId: 'd1', idempotencyKey: 'k1' });
    expect(first.ok).toBe(false);
    expect(lifecycleMock.postSlackWarRoomUpdate).toHaveBeenCalledTimes(1);
    expect(lifecycleMock.updateSlackWarRoomTopic).toHaveBeenCalledTimes(1);
    // Second attempt (retry): message stage is COMPLETED so must not be called again
    lifecycleMock.postSlackWarRoomUpdate.mockClear();
    lifecycleMock.updateSlackWarRoomTopic.mockClear();
    stages.set('slack:lifecycle:message', 'COMPLETED');
    const second = await slackWarRoomAdapter.handleIncidentEvent({ kind: 'LIFECYCLE', incidentId: 'inc-1', status: 'ACKNOWLEDGED', message: 'hi' } as never, { deliveryId: 'd1', idempotencyKey: 'k1' });
    expect(second.ok).toBe(true);
    expect(lifecycleMock.postSlackWarRoomUpdate).not.toHaveBeenCalled();
    expect(lifecycleMock.updateSlackWarRoomTopic).toHaveBeenCalledTimes(1);
  });

  it('Teams projector delegates to neutral participant-desired-state (no duplicate)', async () => {
    const neutral = { projectIncidentWarRoomParticipants: vi.fn().mockResolvedValue(undefined) };
    vi.doMock('@/lib/war-room/participant-desired-state', () => neutral);
    // Re-import wrapper after mock
    vi.resetModules();
    const { projectMicrosoftTeamsWarRoomParticipants } = await import('@/lib/war-room/providers/microsoft-teams/participants');
    await projectMicrosoftTeamsWarRoomParticipants('room-1');
    expect(neutral.projectIncidentWarRoomParticipants).toHaveBeenCalledWith('room-1');
  });
});
