import { describe, expect, it, vi } from 'vitest';
import { savedTurnInputSchema } from '@/lib/intelligence/conversations/contract';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';

const recordExchange = vi.hoisted(() => vi.fn(async () => 'conversation-id'));
vi.mock('@/lib/intelligence/conversations/store', () => ({ recordExchange }));

const { SquireTurnRecorder } = await import('@/lib/intelligence/conversations/turn-record');

const proposal = (action: string, incidentId?: string) =>
  ({
    type: 'proposal',
    proposal: {
      token: 'sealed',
      receiptId: crypto.randomUUID(),
      action,
      kind: 'WRITE',
      title: `Card ${action}`,
      detail: 'detail',
      ...(incidentId ? { incidentId } : {}),
      expiresAt: new Date().toISOString(),
    },
  }) as unknown as SquireEvent;

describe('Squire turn recorder', () => {
  it('saves catalog and plan cards (no incident) as well as incident cards, two per turn', async () => {
    const recorder = new SquireTurnRecorder();
    for (const event of [
      proposal('run_operation'),
      proposal('run_plan'),
      proposal('acknowledge_incident', 'inc-1'),
    ])
      recorder.observe(event);
    expect(recorder.empty).toBe(false);
    await recorder.save({
      userId: 'user-1',
      request: { message: 'Rename it' } as Parameters<typeof recorder.save>[0]['request'],
      completion: 'COMPLETED',
    });
    const turn = (recordExchange.mock.calls[0] as unknown as [{ turn: unknown }])[0].turn;
    const saved = savedTurnInputSchema.parse(turn);
    expect(saved.actions.map(action => action.action)).toEqual(['run_operation', 'run_plan']);
    expect(saved.actions[0]).not.toHaveProperty('incidentId');
  });
});
