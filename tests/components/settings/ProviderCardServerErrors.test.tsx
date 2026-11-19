import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import ProviderCard from '@/components/settings/ProviderCard';
import type { ProviderConfigSchema, ProviderRecord } from '@/types/notification-types';

const mocks = vi.hoisted(() => ({
  updateNotificationProvider: vi.fn(),
  generateVapidKeys: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/app/(app)/settings/system/provider-actions', () => ({
  updateNotificationProvider: mocks.updateNotificationProvider,
  generateVapidKeys: mocks.generateVapidKeys,
}));
vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  notify: { success: mocks.toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/components/settings/ProviderCapacitySettings', () => ({
  default: () => null,
}));

const smtp: ProviderConfigSchema = {
  key: 'smtp',
  name: 'SMTP',
  description: 'Email provider',
  fields: [
    { name: 'host', label: 'SMTP Host', type: 'text', required: true },
    { name: 'password', label: 'Password', type: 'password', required: true },
  ],
};

const existing: ProviderRecord = {
  id: 'prov-smtp',
  provider: 'smtp',
  enabled: false,
  config: { host: 'smtp.example.com', password: '********' },
  updatedAt: '2026-11-01T10:00:00.000Z',
};

function enableAndSave() {
  render(<ProviderCard providerConfig={smtp} existing={existing} isExpanded onToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Toggle SMTP provider' }));
  fireEvent.click(screen.getByRole('button', { name: /Save Configuration/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProviderCard server-action errors', () => {
  it('shows the user-facing message returned by the server action', async () => {
    mocks.updateNotificationProvider.mockResolvedValue({
      success: false,
      code: 'VALIDATION_ERROR',
      error:
        'Stored credentials are unreadable. Supply replacement secret values before enabling this provider.',
    });

    enableAndSave();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stored credentials are unreadable. Supply replacement secret values before enabling this provider.'
    );
    expect(mocks.updateNotificationProvider).toHaveBeenCalledWith(
      'prov-smtp',
      'smtp',
      true,
      existing.config,
      existing.updatedAt
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('never shows a redacted React error when the action call itself throws', async () => {
    mocks.updateNotificationProvider.mockRejectedValue(
      new Error('Minified React error #441; visit https://react.dev/errors/441')
    );

    enableAndSave();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to save configuration. Please try again.');
    expect(alert).not.toHaveTextContent('#441');
  });

  it('saves and refreshes when the action succeeds', async () => {
    mocks.updateNotificationProvider.mockResolvedValue({
      success: true,
      error: null,
      updatedAt: '2026-11-01T10:05:00.000Z',
    });

    enableAndSave();

    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('SMTP configuration saved', {
      id: 'settings:provider:smtp:save',
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
