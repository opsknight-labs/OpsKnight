import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatOpsWarRoomSettings from '@/components/service/ChatOpsWarRoomSettings';

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/app/(app)/services/actions', () => ({
  updateServiceChatOpsSettings: vi.fn(),
}));

describe('ChatOpsWarRoomSettings', () => {
  it('renders correctly with chatOpsEnabled and populated values', () => {
    render(
      <ChatOpsWarRoomSettings
        serviceId="svc-123"
        autoCreateWarRoom={true}
        warRoomVideoBridge="ZOOM"
        warRoomCustomBridgeUrl="https://zoom.us/j/999"
        chatOpsEnabled={true}
        canManage={true}
      />
    );

    expect(screen.getByText('ChatOps & War Room Settings')).toBeInTheDocument();
    expect(screen.getByText('ChatOps Enabled')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', {
      name: /auto-create war room/i,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);

    const bridgeSelect = screen.getByLabelText(/override video bridge/i) as HTMLSelectElement;
    expect(bridgeSelect.value).toBe('ZOOM');
    expect(bridgeSelect.disabled).toBe(false);

    const urlInput = screen.getByLabelText(/custom bridge url/i) as HTMLInputElement;
    expect(urlInput.value).toBe('https://zoom.us/j/999');
    expect(urlInput.disabled).toBe(false);

    const submitBtn = screen.getByRole('button', { name: /save chatops settings/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();
  });

  it('renders unconfigured badge and disabled inputs when canManage is false', () => {
    render(
      <ChatOpsWarRoomSettings
        serviceId="svc-456"
        autoCreateWarRoom={false}
        warRoomVideoBridge={null}
        warRoomCustomBridgeUrl={null}
        chatOpsEnabled={false}
        canManage={false}
      />
    );

    expect(screen.getByText('ChatOps not configured')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', {
      name: /auto-create war room/i,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);

    const bridgeSelect = screen.getByLabelText(/override video bridge/i) as HTMLSelectElement;
    expect(bridgeSelect.value).toBe('INHERIT');
    expect(bridgeSelect.disabled).toBe(true);

    const urlInput = screen.getByLabelText(/custom bridge url/i) as HTMLInputElement;
    expect(urlInput.value).toBe('');
    expect(urlInput.disabled).toBe(true);

    expect(
      screen.queryByRole('button', { name: /save chatops settings/i })
    ).not.toBeInTheDocument();
  });

  it('includes serviceId in hidden input', () => {
    const { container } = render(
      <ChatOpsWarRoomSettings
        serviceId="svc-789"
        autoCreateWarRoom={true}
        warRoomVideoBridge="JITSI"
        warRoomCustomBridgeUrl=""
        chatOpsEnabled={true}
        canManage={true}
      />
    );

    const hiddenServiceId = container.querySelector('input[name="serviceId"]') as HTMLInputElement;
    expect(hiddenServiceId).not.toBeNull();
    expect(hiddenServiceId.value).toBe('svc-789');
  });
});
