import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIncidentWarRooms } from '@/components/incident/war-room/useIncidentWarRooms';
import type { IncidentCollaborationView } from '@/lib/incident-collaboration/types';

const mocks = vi.hoisted(() => ({ notifyError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { error: mocks.notifyError, success: vi.fn() } }));

const collaboration: IncidentCollaborationView = {
  visible: true,
  incidentId: 'inc-1',
  incidentStatus: 'OPEN',
  summary: { activeRooms: 0, transitioningRooms: 0, attentionRequired: 0, totalHistoricalRooms: 0 },
  providers: [],
  meeting: null,
  history: [],
  permissions: { canManageWarRooms: true, canManageMeeting: true },
};

describe('useIncidentWarRooms failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { method?: string }) =>
        init?.method === 'POST'
          ? { ok: false, json: async () => ({ error: { message: 'Policy denied war rooms.' } }) }
          : { ok: true, json: async () => ({ data: collaboration }) }
      )
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('tells the user when creating a war room is refused', async () => {
    const { result } = renderHook(() => useIncidentWarRooms(collaboration));

    await act(async () => {
      await result.current.handleCreate('SLACK');
    });

    expect(mocks.notifyError).toHaveBeenCalledWith('Policy denied war rooms.');
    expect(result.current.error).toBe('Policy denied war rooms.');
  });

  it('tells the user when closing a war room fails', async () => {
    const { result } = renderHook(() => useIncidentWarRooms(collaboration));

    await act(async () => {
      await result.current.handleAction('CLOSE', 'room-1');
    });

    expect(mocks.notifyError).toHaveBeenCalledWith('Policy denied war rooms.');
  });
});
