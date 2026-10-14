import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import type { authenticationDashboard } from '@/lib/auth-control/dashboard';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/components/ui/DetailTabs', () => ({
  default: ({
    tabs,
    onTabChange,
    children,
  }: {
    tabs: Array<{ id: string; label: string }>;
    onTabChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <div>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onTabChange(tab.id)}>
          {tab.label}
        </button>
      ))}
      {children}
    </div>
  ),
  DetailTabContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
describe('authentication section request cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns to an already-loaded section without leaving actions blocked by an aborted request', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => {
      resolve = done;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending)
    );
    const data = {
      section: 'overview',
      actor: { kind: 'admin', id: 'admin' },
      mode: 'PASSWORD_ONLY',
      policyVersion: 1,
      activeRevisionId: null,
      activeProvider: null,
      providerCompatibilityWarning: false,
      providerConfigVersion: 0,
      revisions: [],
      users: [],
      emergencyAccounts: [],
      verifiedEmergencyAccounts: 0,
      events: [],
      replicas: [],
      registeredSessions: [],
      pendingEmailAlerts: 0,
      failedEmailAlerts: [],
      failedEmailAlertCount: 0,
      legacyEmergencyConfigured: false,
      originConflict: false,
      recoveryOrigin: 'https://instance.example.test',
      recoveryOriginPinned: false,
      recoveryDegradedAt: null,
      passwordRecoveryUserId: null,
      passwordRecoveryExpiresAt: null,
      usersHasMore: false,
    } satisfies Awaited<ReturnType<typeof authenticationDashboard>>;
    render(
      <AuthenticationConsole
        initialData={data}
        callbackUrl="https://instance.example.test/api/auth/callback/oidc"
        testCallbackUrl="https://instance.example.test/api/auth/oidc/test/callback"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    expect(screen.getByText('Loading this section…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByText('Loading this section…')).not.toBeInTheDocument();
    await act(async () => {
      resolve(Response.json({ data: { ...data, section: 'connection' } }));
    });
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByText('Loading this section…')).not.toBeInTheDocument();
  });
});
