import { describe, expect, it, vi } from 'vitest';
import { updateIncidentStatus } from '@/lib/incidents/operator-lifecycle';
import { AppError } from '@/lib/errors';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCanAcknowledgeIncident: vi.fn().mockResolvedValue(undefined),
  assertResponderOrAbove: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Test User' }),
}));

const emitAuditEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/audit', () => ({ emitAuditEvent }));

const transitionIncidentToStatusIdempotent = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    replayed: false,
    value: {
      incidentId: 'inc-1',
      command: 'ACKNOWLEDGE',
      source: 'WEB',
      previousStatus: 'OPEN',
      status: 'ACKNOWLEDGED',
      changed: true,
    },
  })
);
vi.mock('@/lib/incidents/idempotent-commands', () => ({ transitionIncidentToStatusIdempotent }));

describe('operator-lifecycle resolution guard', () => {
  it('rejects direct RESOLVED status transition via updateIncidentStatus', async () => {
    await expect(updateIncidentStatus('inc-1', 'RESOLVED', undefined, 'WEB')).rejects.toThrow(
      AppError
    );

    await expect(updateIncidentStatus('inc-1', 'RESOLVED', undefined, 'WEB')).rejects.toMatchObject(
      {
        code: 'INCIDENT_INVALID_ARGUMENT',
        userMessage:
          'Resolving an incident requires a resolution note. Please use resolveIncidentWithNote.',
      }
    );
  });

  it('allows ACKNOWLEDGED status transition via updateIncidentStatus', async () => {
    const result = await updateIncidentStatus('inc-1', 'ACKNOWLEDGED', undefined, 'WEB');
    expect(result).toEqual({ replayed: false });
  });

  it('records the operator as actor and writes an audit event', async () => {
    await updateIncidentStatus('inc-1', 'ACKNOWLEDGED', 'OPEN', 'MOBILE');
    expect(transitionIncidentToStatusIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { id: 'user-1', name: 'Test User' } }),
      undefined
    );
    expect(emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'incident.acknowledged',
        target: { type: 'INCIDENT', id: 'inc-1' },
        actor: expect.objectContaining({ type: 'USER', id: 'user-1' }),
      })
    );
  });
});
