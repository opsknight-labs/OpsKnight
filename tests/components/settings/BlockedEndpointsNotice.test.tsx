import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  resetNotificationEndpoint: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/(app)/settings/actions', () => ({
  resetNotificationEndpoint: mocks.resetNotificationEndpoint,
}));
vi.mock('@/lib/toast', () => ({
  notify: { success: mocks.success, error: mocks.error },
}));

import BlockedEndpointsNotice from '@/components/settings/BlockedEndpointsNotice';

describe('BlockedEndpointsNotice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when no contact is blocked', () => {
    const { container } = render(<BlockedEndpointsNotice endpoints={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('resets a blocked contact and removes it from the list', async () => {
    mocks.resetNotificationEndpoint.mockResolvedValue({ success: true });
    render(<BlockedEndpointsNotice endpoints={[{ channel: 'EMAIL', status: 'BOUNCED' }]} />);

    expect(screen.getByText('Bounced')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(mocks.resetNotificationEndpoint).toHaveBeenCalledWith('EMAIL'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull());
    expect(mocks.success).toHaveBeenCalledWith('Email will be tried again.');
  });

  it('keeps the contact listed and shows the reason when the reset fails', async () => {
    mocks.resetNotificationEndpoint.mockResolvedValue({
      success: false,
      error: 'This contact is not blocked.',
    });
    render(<BlockedEndpointsNotice endpoints={[{ channel: 'SMS', status: 'INVALID' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('This contact is not blocked.'));
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
  });
});
