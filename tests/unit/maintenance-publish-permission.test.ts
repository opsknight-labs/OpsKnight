/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actors = vi.hoisted(() => ({ resolveUserActor: vi.fn() }));
vi.mock('@/lib/authorization-actors', () => actors);

import {
  assertCanPublishMaintenance,
  createMaintenanceWindow,
  updateMaintenanceWindow,
} from '@/lib/service-maintenance/windows';

const operator = { role: 'RESPONDER', capabilities: new Set(['operations.manage']) };
const admin = { role: 'ADMIN', capabilities: new Set(['operations.manage', 'admin.manage']) };
const soon = Date.now() + 60 * 60 * 1000;
const input = {
  title: 'Patch',
  serviceIds: ['svc-1'],
  startsAt: new Date(soon),
  endsAt: new Date(soon + 60 * 60 * 1000),
};

beforeEach(() => vi.clearAllMocks());

describe('publishing maintenance to the status page', () => {
  it('requires administrator access for a person, not for the system actor', async () => {
    actors.resolveUserActor.mockResolvedValueOnce(operator);
    await expect(assertCanPublishMaintenance({ id: 'u1', source: 'API' })).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    actors.resolveUserActor.mockResolvedValueOnce(admin);
    await expect(assertCanPublishMaintenance({ id: 'u2', source: 'API' })).resolves.toBeUndefined();
    await expect(
      assertCanPublishMaintenance({ id: null, source: 'SYSTEM' })
    ).resolves.toBeUndefined();
  });

  it('refuses to create a published window for an operator before touching the database', async () => {
    actors.resolveUserActor.mockResolvedValue(operator);
    const tx = {} as any;
    await expect(
      createMaintenanceWindow(
        { ...input, publishToStatusPage: true },
        { id: 'u1', source: 'UI' },
        { tx }
      )
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('does not check permissions for an unpublished window', async () => {
    const tx = { service: { count: vi.fn().mockResolvedValue(0) } } as any;
    await expect(
      createMaintenanceWindow({ ...input }, { id: 'u1', source: 'UI' }, { tx })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(actors.resolveUserActor).not.toHaveBeenCalled();
  });

  it('refuses an operator turning publishing on for an existing window', async () => {
    actors.resolveUserActor.mockResolvedValue(operator);
    const update = vi.fn();
    const tx = {
      $executeRaw: vi.fn(),
      maintenanceWindow: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'w1',
          revision: 1,
          title: 'Patch',
          description: null,
          startsAt: new Date(soon),
          endsAt: new Date(soon + 60 * 60 * 1000),
          endProcessedAt: null,
          publishToStatusPage: false,
          services: [{ serviceId: 'svc-1' }],
        }),
        update,
      },
    } as any;
    await expect(
      updateMaintenanceWindow(
        'w1',
        { publishToStatusPage: true },
        { id: 'u1', source: 'API' },
        { tx }
      )
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(update).not.toHaveBeenCalled();
  });
});
