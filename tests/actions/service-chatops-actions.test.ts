import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanModifyService: vi.fn(),
  serviceUpdate: vi.fn(),
  userFindMany: vi.fn(),
  setServiceWarRoomPolicy: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: mocks.assertCanModifyService,
}));

vi.mock('@/lib/incident-collaboration/policy', () => ({
  setServiceWarRoomPolicy: mocks.setServiceWarRoomPolicy,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: {
      update: mocks.serviceUpdate,
    },
    user: { findMany: mocks.userFindMany },
  },
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mocks.logAudit,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

import {
  searchWarRoomAutoAddPeople,
  updateServiceChatOpsSettings,
  updateServiceWarRoomAutoAdd,
} from '@/app/(app)/services/actions';

describe('updateServiceChatOpsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1' });
    mocks.serviceUpdate.mockResolvedValue({});
  });

  it('updates chatops settings successfully when called with (serviceId, formData)', async () => {
    const formData = new FormData();
    formData.set('autoCreateWarRoom', 'on');
    formData.set('warRoomVideoBridge', 'ZOOM');
    formData.set('warRoomCustomBridgeUrl', 'https://zoom.us/j/123456');

    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({ success: true, error: null });
    expect(mocks.serviceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: {
        autoCreateWarRoom: true,
        warRoomVideoBridge: 'ZOOM',
        warRoomCustomBridgeUrl: 'https://zoom.us/j/123456',
      },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'service.chatops.updated',
        entityId: 'svc-1',
        actorId: 'user-1',
      })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/services/svc-1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/services/svc-1/settings');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('updates chatops settings successfully when called via useActionState (prevState, formData)', async () => {
    const formData = new FormData();
    formData.set('serviceId', 'svc-2');
    formData.set('warRoomVideoBridge', 'INHERIT');
    // autoCreateWarRoom not checked (omitted in formData)
    formData.set('warRoomCustomBridgeUrl', '');

    const result = await updateServiceChatOpsSettings({ success: false }, formData);

    expect(result).toEqual({ success: true, error: null });
    expect(mocks.serviceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-2' },
      data: {
        autoCreateWarRoom: false,
        warRoomVideoBridge: null,
        warRoomCustomBridgeUrl: null,
      },
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('accepts valid custom bridge URL containing {incidentId}', async () => {
    const formData = new FormData();
    formData.set('autoCreateWarRoom', 'on');
    formData.set('warRoomVideoBridge', 'NONE');
    formData.set('warRoomCustomBridgeUrl', 'https://meet.custom.io/{incidentId}');

    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({ success: true, error: null });
    expect(mocks.serviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          warRoomCustomBridgeUrl: 'https://meet.custom.io/{incidentId}',
        }),
      })
    );
  });

  it('rejects invalid custom bridge URL protocol', async () => {
    const formData = new FormData();
    formData.set('warRoomCustomBridgeUrl', 'javascript:alert(1)');

    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({
      error: 'Custom bridge URL must use HTTP or HTTPS protocol.',
    });
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed custom bridge URL', async () => {
    const formData = new FormData();
    formData.set('warRoomCustomBridgeUrl', 'http://::invalid::');

    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({
      error: 'Please enter a valid URL for the custom bridge.',
    });
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('rejects unsupported video bridge option', async () => {
    const formData = new FormData();
    formData.set('warRoomVideoBridge', 'INVALID_BRIDGE');

    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({
      error: 'Invalid video bridge option.',
    });
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('returns error when serviceId is missing', async () => {
    const formData = new FormData();
    const result = await updateServiceChatOpsSettings(undefined, formData);

    expect(result).toEqual({
      error: 'Service ID is required.',
    });
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('returns error when assertCanModifyService throws', async () => {
    mocks.assertCanModifyService.mockRejectedValue(new Error('Permission denied'));

    const formData = new FormData();
    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({
      error: 'Permission denied',
    });
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid providerMode with a validation error', async () => {
    const formData = new FormData();
    formData.set('providerMode', 'INVALID_MODE');

    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({
      error: 'Invalid war room provider mode.',
    });
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
    expect(mocks.setServiceWarRoomPolicy).not.toHaveBeenCalled();
  });

  it('persists Teams-only providerMode with autoCreate: true to canonical policy', async () => {
    const formData = new FormData();
    formData.set('providerMode', 'MICROSOFT_TEAMS');
    formData.set('autoCreateWarRoom', 'on');
    formData.set('warRoomsEnabled', 'true');
    formData.set('warRoomVideoBridge', 'MICROSOFT_TEAMS');

    const result = await updateServiceChatOpsSettings('svc-1', formData);

    expect(result).toEqual({ success: true, error: null });
    expect(mocks.setServiceWarRoomPolicy).toHaveBeenCalledWith(
      'svc-1',
      {
        serviceProviders: ['MICROSOFT_TEAMS'],
        meetingProvider: 'MICROSOFT_TEAMS',
        warRoomsEnabled: true,
        autoCreate: true,
      },
      'user-1',
      undefined
    );
  });
});

describe('updateServiceWarRoomAutoAdd', () => {
  const form = (team: string, ids: string[]) => {
    const data = new FormData();
    data.set('serviceId', 'svc-1');
    data.set('warRoomAutoAddTeam', team);
    ids.forEach(id => data.append('userIds', id));
    return data;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1' });
    mocks.serviceUpdate.mockResolvedValue({});
  });

  it('saves the team option and only the active people chosen', async () => {
    mocks.userFindMany.mockResolvedValue([{ id: 'a' }]);
    const result = await updateServiceWarRoomAutoAdd(undefined, form('MANAGERS', ['a', 'gone']));
    expect(result).toEqual({ success: true, error: null });
    expect(mocks.userFindMany.mock.calls[0][0].where.status).toBe('ACTIVE');
    expect(mocks.serviceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: { warRoomAutoAddTeam: 'MANAGERS', warRoomAutoAddUserIds: ['a'] },
    });
  });

  it('rejects an unknown team option and more than 25 people without saving', async () => {
    expect((await updateServiceWarRoomAutoAdd(undefined, form('EVERYONE', []))).error).toMatch(
      /Invalid/
    );
    const many = Array.from({ length: 26 }, (_, i) => `u${i}`);
    expect((await updateServiceWarRoomAutoAdd(undefined, form('NONE', many))).error).toMatch(
      /at most 25/
    );
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('is refused when the user cannot modify the service', async () => {
    mocks.assertCanModifyService.mockRejectedValue(new Error('Forbidden'));
    const result = await updateServiceWarRoomAutoAdd(undefined, form('ALL', []));
    expect(result.error).toBe('Forbidden');
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('rejects oversized ids and files in the payload', async () => {
    const tooLong = form('NONE', ['x'.repeat(65)]);
    expect((await updateServiceWarRoomAutoAdd(undefined, tooLong)).error).toBeTruthy();
    const file = form('NONE', []);
    file.append('userIds', new Blob(['x']), 'a.txt');
    expect((await updateServiceWarRoomAutoAdd(undefined, file)).error).toBeTruthy();
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });
});

describe('searchWarRoomAutoAddPeople', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1' });
  });

  it('searches active users by name or email, bounded, for editors only', async () => {
    mocks.userFindMany.mockResolvedValue([{ id: 'a', name: 'Ana', email: 'a@x.io' }]);
    expect(await searchWarRoomAutoAddPeople('svc-1', ' an ')).toHaveLength(1);
    const args = mocks.userFindMany.mock.calls[0][0];
    expect(args.take).toBe(30);
    expect(args.where.status).toBe('ACTIVE');
    expect(args.where.NOT.email.endsWith).toBe('@serviceaccount.opsknight.local');
    expect(args.where.OR).toHaveLength(2);
    mocks.assertCanModifyService.mockRejectedValue(new Error('Forbidden'));
    await expect(searchWarRoomAutoAddPeople('svc-1', 'x')).rejects.toThrow('Forbidden');
  });

  it('returns nothing for an invalid query', async () => {
    expect(await searchWarRoomAutoAddPeople('svc-1', 'x'.repeat(101))).toEqual([]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});
