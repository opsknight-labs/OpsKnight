import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MicrosoftTeamsIntegrationPage, {
  type MicrosoftTeamsIntegrationPageProps,
} from '@/components/settings/microsoft-teams/MicrosoftTeamsIntegrationPage';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings/integrations/microsoft-teams',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/settings/microsoft-teams/MicrosoftTeamsSetupWizard', () => ({
  default: () => <div data-testid="wizard" />,
}));
vi.mock('@/components/settings/microsoft-teams/WarRoomOperationsSection', () => ({
  default: () => <div data-testid="war-rooms" />,
}));
vi.mock('@/components/settings/microsoft-teams/TeamsHealthChecklist', () => ({
  TeamsAppUpdateGuide: () => null,
  TeamsHealthChecklist: () => null,
  TeamsSecretExpiryBanner: () => null,
  TeamsTestResultMessage: () => null,
}));
vi.mock('@/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

const props: MicrosoftTeamsIntegrationPageProps = {
  config: {
    id: 'cfg',
    clientId: 'client-1234567890',
    tenantId: 'tenant-1',
    tenantMode: 'SINGLE',
    enabled: true,
    interactiveEnabled: true,
    warRoomsEnabled: false,
  },
  destinations: [
    {
      id: 'd1',
      serviceId: 's1',
      tenantId: 'tenant-1',
      teamId: 't1',
      channelId: 'c1',
      enabled: true,
      interactiveEnabled: true,
      warRoomEnabled: false,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-01T00:00:00Z'),
    },
    {
      id: 'd2',
      serviceId: 's2',
      tenantId: 'tenant-1',
      teamId: 't1',
      channelId: 'c2',
      enabled: true,
      interactiveEnabled: true,
      warRoomEnabled: false,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-01T00:00:00Z'),
    },
  ],
  appManifestJson: '{}',
  isAdmin: true,
  installationCount: 3,
  installationPermissions: [],
};

describe('Microsoft Teams disconnect confirmation', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  it('states exactly what is deleted and needs the name typed before it deletes anything', async () => {
    render(<MicrosoftTeamsIntegrationPage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^Disconnect$/ }));

    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/3 bot installations/)).toBeInTheDocument();
    expect(screen.getByText(/2 channel mappings/)).toBeInTheDocument();
    expect(screen.getByText(/the card ledger/)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /Disconnect and delete/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Microsoft Teams'), {
      target: { value: 'Microsoft Teams' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/settings/microsoft-teams', { method: 'DELETE' })
    );
  });
});
