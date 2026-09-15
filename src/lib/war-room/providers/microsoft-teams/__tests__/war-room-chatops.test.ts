/**
 * Behavioral tests — Phase 4 war-room ChatOps coverage.
 *
 * Covers the scenarios the reviewer explicitly requested:
 *  1. READY room → WAR_ROOM_PROJECT job queued
 *  2. CLOSED room → null returned, no job queued
 *  3. Priority trigger → projection queued for all READY rooms in incident
 *  4. Snooze trigger → projection queued for all READY rooms in incident
 *  5. JOIN_RESPONDER unsupported Slack action → slackContractForKind returns null
 *  6. Supported Slack actions → returned correctly
 *  7. Resolution note: blank→undefined, 10-1000 valid, 1-9 error, >1000 error
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.mock with inline factory functions (no top-level vars) to avoid hoisting issues.
vi.mock('@/lib/prisma', () => {
  const updateMany = vi.fn();
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const create = vi.fn();
  const findUniqueOrThrow = vi.fn();
  return {
    default: {
      incidentWarRoom: { updateMany, findUnique, findMany },
      backgroundJob: { create },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          incidentWarRoom: { updateMany, findUniqueOrThrow },
          backgroundJob: { create },
        })
      ),
      __mocks: { updateMany, findUnique, findMany, create, findUniqueOrThrow },
    },
  };
});

vi.mock('@/lib/microsoft-teams/client', () => ({
  sendMicrosoftTeamsIncidentCard: vi.fn(),
  updateMicrosoftTeamsIncidentCard: vi.fn(),
}));

vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: () => 'https://opsknight.test',
}));

vi.mock('@/lib/metrics/operational/registry', () => ({
  addOperationalMetric: vi.fn(),
}));

import prisma from '@/lib/prisma';
import {
  requestMicrosoftTeamsWarRoomProjection,
  requestMicrosoftTeamsWarRoomProjectionForIncident,
} from '../projection';
import { slackContractForKind } from '@/lib/chatops/slack-action-map';
import {
  parseMicrosoftTeamsAction,
  TEAMS_CHATOPS_VERBS,
} from '@/lib/microsoft-teams/action-schema';
import type { ChatOpsActionKind } from '@/lib/chatops/action-contract';

// Pull the mock helpers out of the module so we can configure them per-test.
// Cast is safe — we own the mock shape above.
const mocks = (
  prisma as unknown as {
    __mocks: {
      updateMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
    };
  }
).__mocks;

function baseContext(overrides?: Record<string, unknown>) {
  return {
    v: 2,
    incidentId: 'inc-1',
    destinationId: 'dest-1',
    messageGeneration: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1-4 — Projection queuing
// ---------------------------------------------------------------------------
describe('requestMicrosoftTeamsWarRoomProjection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues WAR_ROOM_PROJECT for a READY room and returns the new version', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ projectionVersion: 3 });
    mocks.create.mockResolvedValueOnce({});

    const version = await requestMicrosoftTeamsWarRoomProjection('room-1');

    expect(version).toBe(3);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'WAR_ROOM_PROJECT',
          status: 'PENDING',
          payload: { warRoomId: 'room-1', projectionVersion: 3 },
        }),
      })
    );
  });

  it('returns null and does not queue a job when room is not in READY/CLOSING (CLOSED)', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const version = await requestMicrosoftTeamsWarRoomProjection('room-closed');

    expect(version).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('queues projection for each READY room in an incident (Priority/Snooze trigger path)', async () => {
    mocks.findMany.mockResolvedValueOnce([{ id: 'room-a' }, { id: 'room-b' }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue({ projectionVersion: 5 });
    mocks.create.mockResolvedValue({});

    await requestMicrosoftTeamsWarRoomProjectionForIncident('inc-priority');

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          incidentId: 'inc-priority',
          provider: 'MICROSOFT_TEAMS',
          state: 'READY',
        }),
      })
    );
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it('queues projection for a single READY room (Snooze lifecycle trigger)', async () => {
    mocks.findMany.mockResolvedValueOnce([{ id: 'room-snooze' }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue({ projectionVersion: 2 });
    mocks.create.mockResolvedValue({});

    await requestMicrosoftTeamsWarRoomProjectionForIncident('inc-snooze');

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'WAR_ROOM_PROJECT' }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 5 & 6 — Slack action omission
// ---------------------------------------------------------------------------
describe('slackContractForKind — unsupported actions are omitted, not resolved', () => {
  const unsupportedKinds: ChatOpsActionKind[] = [
    'ADD_NOTE',
    'SET_PRIORITY',
    'SNOOZE',
    'ESCALATE',
    'JOIN_RESPONDER',
    'VIEW_RESPONDERS',
    'REFRESH',
  ];

  it.each(unsupportedKinds)(
    '%s → null (omitted from Slack block, never falls back to Resolve)',
    kind => {
      expect(slackContractForKind(kind)).toBeNull();
    }
  );

  it('ACKNOWLEDGE → Slack ack binding', () => {
    expect(slackContractForKind('ACKNOWLEDGE')).toEqual({
      actionId: 'ack_incident',
      actionValue: 'ack',
      label: 'Acknowledge',
    });
  });

  it('RESOLVE → Slack resolve binding', () => {
    expect(slackContractForKind('RESOLVE')).toEqual({
      actionId: 'resolve_incident',
      actionValue: 'resolve',
      label: 'Resolve',
    });
  });

  it('ASSIGN_SELF → Slack assign binding', () => {
    expect(slackContractForKind('ASSIGN_SELF')).toEqual({
      actionId: 'assign_me_incident',
      actionValue: 'assign_me',
      label: 'Assign to me',
    });
  });
});

// ---------------------------------------------------------------------------
// 7 — Resolution note schema bounds
// ---------------------------------------------------------------------------
describe('parseMicrosoftTeamsAction — RESOLVE resolutionNote bounds', () => {
  function resolvePayload(resolutionNote?: string) {
    return {
      action: {
        type: 'Action.Execute',
        verb: TEAMS_CHATOPS_VERBS.RESOLVE,
        data: {
          ...baseContext(),
          ...(resolutionNote !== undefined ? { resolutionNote } : {}),
        },
      },
    };
  }

  it('absent resolutionNote → undefined', () => {
    const r = parseMicrosoftTeamsAction(resolvePayload());
    expect((r.data as { resolutionNote?: string }).resolutionNote).toBeUndefined();
  });

  it('empty string "" → undefined', () => {
    const r = parseMicrosoftTeamsAction(resolvePayload(''));
    expect((r.data as { resolutionNote?: string }).resolutionNote).toBeUndefined();
  });

  it('whitespace-only "   " → undefined', () => {
    const r = parseMicrosoftTeamsAction(resolvePayload('   '));
    expect((r.data as { resolutionNote?: string }).resolutionNote).toBeUndefined();
  });

  it('10-char note → valid (domain minimum)', () => {
    const note = 'a'.repeat(10);
    const r = parseMicrosoftTeamsAction(resolvePayload(note));
    expect((r.data as { resolutionNote?: string }).resolutionNote).toBe(note);
  });

  it('1000-char note → valid (domain maximum)', () => {
    const note = 'a'.repeat(1000);
    const r = parseMicrosoftTeamsAction(resolvePayload(note));
    expect((r.data as { resolutionNote?: string }).resolutionNote).toBe(note);
  });

  it('1-char note (non-blank, < 10) → validation error', () => {
    expect(() => parseMicrosoftTeamsAction(resolvePayload('a'))).toThrow();
  });

  it('9-char note (< domain minimum) → validation error', () => {
    expect(() => parseMicrosoftTeamsAction(resolvePayload('a'.repeat(9)))).toThrow();
  });

  it('1001-char note (> domain maximum) → validation error', () => {
    expect(() => parseMicrosoftTeamsAction(resolvePayload('a'.repeat(1001)))).toThrow();
  });

  it('2000-char note (old schema max, now invalid) → validation error', () => {
    expect(() => parseMicrosoftTeamsAction(resolvePayload('a'.repeat(2000)))).toThrow();
  });

  it('10-char note with surrounding whitespace → trimmed, passes', () => {
    const r = parseMicrosoftTeamsAction(resolvePayload('  ' + 'a'.repeat(10) + '  '));
    expect((r.data as { resolutionNote?: string }).resolutionNote).toBe('a'.repeat(10));
  });
});
