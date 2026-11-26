import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  actor: vi.fn(),
  setEmbedEnabled: vi.fn(),
  shareView: vi.fn(),
  simulateFailure: vi.fn(),
  getGraphAt: vi.fn(),
  graphTimeline: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentAuthorizationActor: m.actor,
  assertCanModifyService: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/intelligence/dependencies/insights/views', () => ({
  viewInputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
  setEmbedEnabled: m.setEmbedEnabled,
  shareView: m.shareView,
  createView: vi.fn(),
  deleteView: vi.fn(),
  listViews: vi.fn(),
  revokeShare: vi.fn(),
  updateView: vi.fn(),
}));
vi.mock('@/lib/intelligence/dependencies/insights/service', () => ({
  simulateFailure: m.simulateFailure,
  getGraphAt: m.getGraphAt,
  graphTimeline: m.graphTimeline,
  diffGraph: vi.fn(),
  findSinglePointsOfFailure: vi.fn(),
}));

import {
  getGraphAtAction,
  getGraphTimelineAction,
  setGraphEmbedEnabledAction,
  shareGraphViewAction,
  simulateFailureAction,
} from '@/app/(app)/services/graph/actions';

const actor = (role: string, status = 'ACTIVE') =>
  ({ id: 'u1', role, status, teamIds: [] }) as never;

beforeEach(() => vi.clearAllMocks());

describe('graph insight actions: RBAC', () => {
  it.each(['RESPONDER', 'AUDITOR', 'USER', 'STAKEHOLDER'])(
    '%s cannot share a view or toggle embeds',
    async role => {
      m.actor.mockResolvedValue(actor(role));
      expect(await shareGraphViewAction({ id: 'v1' })).toMatchObject({ ok: false });
      expect(await setGraphEmbedEnabledAction({ enabled: true })).toMatchObject({ ok: false });
      expect(m.shareView).not.toHaveBeenCalled();
      expect(m.setEmbedEnabled).not.toHaveBeenCalled();
    }
  );

  it('lets an admin through', async () => {
    m.actor.mockResolvedValue(actor('ADMIN'));
    m.setEmbedEnabled.mockResolvedValue(undefined);
    expect(await setGraphEmbedEnabledAction({ enabled: true })).toEqual({ ok: true, data: null });
    expect(m.setEmbedEnabled).toHaveBeenCalledOnce();
  });

  it('refuses a disabled user on reads', async () => {
    m.actor.mockResolvedValue(actor('ADMIN', 'DISABLED'));
    expect(await simulateFailureAction({ serviceIds: ['s1'] })).toMatchObject({ ok: false });
    expect(m.simulateFailure).not.toHaveBeenCalled();
  });

  it('rejects malformed input before touching the data layer', async () => {
    m.actor.mockResolvedValue(actor('ADMIN'));
    expect(await simulateFailureAction({ serviceIds: [] })).toMatchObject({ ok: false });
    expect(await simulateFailureAction({ serviceIds: ['s1'], extra: 1 })).toMatchObject({
      ok: false,
    });
    expect(await getGraphAtAction({ at: 'yesterday' })).toMatchObject({ ok: false });
    expect(m.simulateFailure).not.toHaveBeenCalled();
    expect(m.getGraphAt).not.toHaveBeenCalled();
    expect(await getGraphTimelineAction({ hops: 9 })).toMatchObject({ ok: false });
    expect(m.graphTimeline).not.toHaveBeenCalled();
  });

  it('passes the timeline scope through for an active user', async () => {
    m.actor.mockResolvedValue(actor('STAKEHOLDER'));
    m.graphTimeline.mockResolvedValue({ days: 90, incidents: [], changes: [], truncated: false });
    expect(await getGraphTimelineAction({ focus: 'svc:a', hops: 2 })).toMatchObject({ ok: true });
    expect(m.graphTimeline).toHaveBeenCalledWith(expect.anything(), { focus: 'svc:a', hops: 2 });
  });

  it('turns a data-layer failure into a message, not a throw', async () => {
    m.actor.mockResolvedValue(actor('USER'));
    m.getGraphAt.mockRejectedValue(new Error('boom'));
    expect(await getGraphAtAction({ at: '2026-01-01T00:00:00Z' })).toMatchObject({ ok: false });
  });
});
