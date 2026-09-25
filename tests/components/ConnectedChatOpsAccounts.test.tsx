import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConnectedChatOpsAccounts from '@/components/settings/ConnectedChatOpsAccounts';
import { notify as toast } from '@/lib/toast';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ConnectedChatOpsAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when links array is empty', () => {
    const { container } = render(<ConnectedChatOpsAccounts links={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders connected accounts when links exist', () => {
    const links = [
      {
        id: 'link-1',
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: 'tenant-123',
        displayName: 'Alice Engineer',
      },
      {
        id: 'link-2',
        provider: 'SLACK',
        providerTenantId: 'T012345',
        displayName: null,
      },
    ];

    render(<ConnectedChatOpsAccounts links={links} />);

    expect(screen.getByText('Connected ChatOps Accounts')).toBeInTheDocument();
    expect(screen.getByText(/Microsoft Teams · Alice Engineer/)).toBeInTheDocument();
    expect(screen.getByText('Tenant tenant-123')).toBeInTheDocument();
    expect(screen.getByText(/Slack · Linked account/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2);
  });

  it('unlinks an account and refreshes on Disconnect click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;

    const links = [
      {
        id: 'link-1',
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: 'tenant-123',
        displayName: 'Alice Engineer',
      },
    ];

    render(<ConnectedChatOpsAccounts links={links} />);

    const disconnectBtn = screen.getByRole('button', { name: 'Disconnect' });
    fireEvent.click(disconnectBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/settings/chatops/identities',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ id: 'link-1' }),
        })
      );
      expect(toast.success).toHaveBeenCalledWith('ChatOps account disconnected.');
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
