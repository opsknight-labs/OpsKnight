import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanModifyService: vi.fn(),
  serviceUpdate: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: mocks.assertCanModifyService,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: {
      update: mocks.serviceUpdate,
    },
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

import { updateServiceChatOpsSettings } from '@/app/(app)/services/actions';

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
});
