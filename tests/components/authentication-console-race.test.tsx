import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const fixtureDashboard = {
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
  pendingEmailFanoutJobs: 0,
  deliveredEmailAlertCount: 0,
  cancelledEmailAlertCount: 0,
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
    const data = fixtureDashboard;
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
  it('preserves retry confirmation when the console catches a server rejection', async () => {
    const data = { ...fixtureDashboard, section: 'diagnostics' as const, failedEmailAlertCount: 1 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST')
          return Response.json({ error: 'Server retry denied' }, { status: 403 });
        if (String(url).includes('view=alerts'))
          return Response.json({
            data: {
              alerts: [
                {
                  id: 'failed-1',
                  eventId: 'event',
                  recipientId: 'admin',
                  title: 'Failed security event',
                  state: 'FAILED',
                  deliveryGeneration: 2,
                  attempts: 3,
                  lastError: null,
                  createdAt: '2026-10-14T00:00:00.000Z',
                  completedAt: '2026-10-14T00:00:00.000Z',
                },
              ],
              nextCursor: null,
            },
          });
        return Response.json({ data });
      })
    );
    render(
      <AuthenticationConsole
        initialData={data}
        callbackUrl="https://instance.example.test/api/auth/callback/oidc"
        testCallbackUrl="https://instance.example.test/api/auth/oidc/test/callback"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm email retry' }));
    await waitFor(() => expect(screen.getByText('Server retry denied')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Confirm email retry' })).toBeEnabled();
  });
});
