import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRealtimeConnectionStatus, OFFLINE_AFTER_MS } from '@/hooks/useRealtimeConnectionStatus';

const realtime = {
  isConnected: false,
  isRevoked: false,
  isOnline: true,
  outageStartedAt: null as number | null,
};

vi.mock('@/hooks/useRealtime', () => ({
  useOptionalRealtime: () => realtime,
}));

const success = vi.fn();
vi.mock('@/lib/toast', () => ({
  notify: { success: (...args: unknown[]) => success(...args) },
}));

import ConnectionIndicator from '@/components/layout/ConnectionIndicator';

describe('getRealtimeConnectionStatus', () => {
  const base = { isConnected: false, isRevoked: false, isOnline: true, outageStartedAt: null };

  it('maps the stream state to Live / Reconnecting / Offline', () => {
    expect(getRealtimeConnectionStatus({ ...base, isConnected: true }, 0)).toBe('live');
    expect(getRealtimeConnectionStatus(base, 0)).toBe('connecting');
    expect(getRealtimeConnectionStatus({ ...base, outageStartedAt: 1000 }, 2000)).toBe(
      'reconnecting'
    );
    expect(
      getRealtimeConnectionStatus({ ...base, outageStartedAt: 1000 }, 1000 + OFFLINE_AFTER_MS)
    ).toBe('offline');
  });

  it('is offline when the browser is offline or the session was revoked', () => {
    expect(getRealtimeConnectionStatus({ ...base, isConnected: true, isOnline: false }, 0)).toBe(
      'offline'
    );
    expect(getRealtimeConnectionStatus({ ...base, isRevoked: true }, 0)).toBe('offline');
  });
});

describe('ConnectionIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(realtime, {
      isConnected: false,
      isRevoked: false,
      isOnline: true,
      outageStartedAt: null,
    });
    success.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the status, announces changes politely and toasts when restored after an outage', () => {
    realtime.isConnected = true;
    const { container, rerender } = render(<ConnectionIndicator />);
    expect(screen.getByText('Live updates: Live')).toBeInTheDocument();
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeEmptyDOMElement();

    Object.assign(realtime, { isConnected: false, isOnline: false, outageStartedAt: Date.now() });
    rerender(<ConnectionIndicator />);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(container.querySelector('[data-connection-status]')).toHaveAttribute(
      'data-connection-status',
      'offline'
    );
    expect(liveRegion).toHaveTextContent('Live updates: Offline');
    expect(success).not.toHaveBeenCalled();

    Object.assign(realtime, { isConnected: true, isOnline: true, outageStartedAt: null });
    rerender(<ConnectionIndicator />);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(liveRegion).toHaveTextContent('Live updates: Live');
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('stays hidden on mobile while live and appears when degraded', () => {
    realtime.isConnected = true;
    const { rerender } = render(<ConnectionIndicator variant="mobile" />);
    expect(screen.queryByText('Reconnecting')).toBeNull();

    Object.assign(realtime, { isConnected: false, outageStartedAt: Date.now() });
    rerender(<ConnectionIndicator variant="mobile" />);
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });
});
