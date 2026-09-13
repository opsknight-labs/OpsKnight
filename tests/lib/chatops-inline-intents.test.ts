import { beforeEach, describe, expect, it, vi } from 'vitest';

type IntentState = {
  id: string;
  status: string;
  encryptedPayload: string;
  responsePayload: unknown;
  responseMode: 'INLINE';
  provider: 'MICROSOFT_TEAMS';
  leaseToken: string | null;
};

let state: IntentState;

const chatOpsIntent = {
  findUnique: vi.fn(async () => ({ ...state })),
  create: vi.fn(),
  updateMany: vi.fn(async (args: { where: { status?: string; leaseToken?: string; OR?: Array<{ status?: string | { in: string[] } }> }; data: { status: string; leaseToken?: string | null; responsePayload?: unknown } }) => {
    const statuses = args.where.OR?.flatMap(condition => {
      if (typeof condition.status === 'string') return [condition.status];
      return condition.status?.in ?? [];
    }) ?? (args.where.status ? [args.where.status] : []);
    const matchesStatus = statuses.length === 0 || statuses.includes(state.status);
    const matchesLease = !args.where.leaseToken || args.where.leaseToken === state.leaseToken;
    if (!matchesStatus || !matchesLease) return { count: 0 };
    state = {
      ...state,
      status: args.data.status,
      leaseToken: args.data.leaseToken === undefined ? state.leaseToken : args.data.leaseToken,
      responsePayload: args.data.responsePayload === undefined ? state.responsePayload : args.data.responsePayload,
    };
    return { count: 1 };
  }),
};

import { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({
  default: {
    chatOpsIntent,
    $transaction: vi.fn(async (cb: (tx: { chatOpsIntent: typeof chatOpsIntent }) => Promise<unknown>) => cb({ chatOpsIntent })),
  },
}));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(async (value: string) => value), encrypt: vi.fn(async (value: string) => value) }));

describe('inline ChatOps intent durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      id: 'intent-1', status: 'PENDING', encryptedPayload: '{"verb":"ack"}',
      responsePayload: null, responseMode: 'INLINE', provider: 'MICROSOFT_TEAMS', leaseToken: null,
    };
  });

  it('executes the effect once, persists its response, and replays it exactly', async () => {
    const { processInlineChatOpsIntent } = await import('@/lib/chatops/intents');
    const execute = vi.fn(async () => ({ statusCode: 200, value: 'acknowledged' }));

    const first = await processInlineChatOpsIntent('intent-1', execute);
    const replay = await processInlineChatOpsIntent('intent-1', execute);

    expect(first).toEqual({ statusCode: 200, value: 'acknowledged' });
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('COMPLETED');
  });

  it('recovers a crash after effect persistence without repeating the mutation', async () => {
    state.status = 'RESPONSE_PENDING';
    state.responsePayload = { statusCode: 200, value: 'already persisted' };
    const { processInlineChatOpsIntent } = await import('@/lib/chatops/intents');
    const execute = vi.fn(async () => ({ statusCode: 500 }));

    await expect(processInlineChatOpsIntent('intent-1', execute)).resolves.toEqual(state.responsePayload);
    expect(execute).not.toHaveBeenCalled();
    expect(state.status).toBe('COMPLETED');
  });

  it('deduplicates a legacy Slack hash before attempting a new-format insert', async () => {
    chatOpsIntent.findUnique.mockResolvedValueOnce({ id: 'legacy-intent', payloadDigest: null } as never);
    const { enqueueChatOpsIntent } = await import('@/lib/chatops/intents');

    await expect(enqueueChatOpsIntent({
      provider: 'SLACK', kind: 'INTERACTIVE_ACTION', signature: 'signed-retry', workspaceId: 'workspace-1',
      payload: { action: 'note' }, responseMode: 'INLINE',
    })).resolves.toEqual({ id: 'legacy-intent', duplicate: true });

    expect(chatOpsIntent.create).not.toHaveBeenCalled();
  });

  it('deduplicates a delivery retry of a snooze intent even if snoozedUntil deadline timestamp recomputes', async () => {
    const { enqueueChatOpsIntent, payloadDigestFromPayload } = await import('@/lib/chatops/intents');
    const digest = payloadDigestFromPayload({ action: 'snooze', incidentId: 'inc-1', snoozedUntil: '2026-09-13T10:30:00.000Z' });

    // Simulate P2002 conflict on insert
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    chatOpsIntent.create.mockRejectedValueOnce(error);
    chatOpsIntent.findUnique.mockResolvedValueOnce({ id: 'intent-1', payloadDigest: digest } as never);

    const res = await enqueueChatOpsIntent({
      provider: 'MICROSOFT_TEAMS',
      kind: 'INTERACTIVE_ACTION',
      signature: 'teams-snooze-retry',
      workspaceId: 'tenant-1',
      payload: { action: 'snooze', incidentId: 'inc-1', snoozedUntil: '2026-09-13T10:35:00.000Z' },
      responseMode: 'INLINE',
    });

    expect(res).toEqual({ id: 'intent-1', duplicate: true });
  });
});
