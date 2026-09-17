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

vi.mock('@/lib/incidents/idempotent-commands', () => ({
  transitionIncidentToStatusIdempotent: vi.fn().mockResolvedValue({
    replayed: false,
    value: { changed: true },
  }),
}));

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
});
