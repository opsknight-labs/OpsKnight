import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { providerConfigSchema } from '@/lib/auth-control/provider-config';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import {
  reconcileRevisionSelection,
  type DashboardRevision,
} from '@/components/settings/authentication/useAuthenticationController';
import type { OidcProofStatus } from '@/lib/auth-control/proof-status';
import { fixtureDashboard } from '../helpers/authentication-dashboard';

vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings/system',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

type Dashboard = Awaited<ReturnType<typeof authenticationDashboard>>;
const configuration = {
  ...providerConfigSchema.parse({
    providerType: 'azure',
    issuer: 'https://login.microsoftonline.com/tenant-1/v2.0',
    clientId: 'app-b',
    clientSecret: '',
  }),
  hasClientSecret: true,
};
const required: OidcProofStatus = {
  state: 'required',
  verifiedAt: null,
  expiresAt: null,
  adminUserId: null,
};
const revision = (id: string, overrides: Partial<DashboardRevision> = {}): DashboardRevision => ({
  id,
  baseConfigVersion: 0,
  configuration,
  createdAt: '2026-10-14T10:00:00.000Z',
  discoveryVerifiedAt: '2026-10-14T10:00:00.000Z',
  activatedAt: null,
  previousRevisionId: null,
  testedAt: '',
  testedAdminId: '',
  createdByLabel: 'admin@example.test',
  verification: required,
  ...overrides,
});
const admin = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.test',
  role: 'ADMIN' as const,
  roleSource: 'MANUAL' as const,
  status: 'ACTIVE' as const,
  issuers: [] as string[],
  linkingState: 'not-approved' as const,
  oidcIdentities: undefined,
};
const dashboard = (overrides: Partial<Dashboard> = {}): Dashboard =>
  ({
    ...fixtureDashboard,
    users: [admin],
    revisions: [revision('draft-1'), revision('draft-2')],
    ...overrides,
  }) as Dashboard;

let server: Dashboard;
const requests: Array<Record<string, unknown>> = [];
beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push(body);
        if (body.action === 'deleteRevision')
          server = {
            ...server,
            revisions: server.revisions.filter(item => item.id !== body.revisionId),
          };
        if (body.action === 'test') return Response.json({ data: { url: 'about:blank' } });
        return Response.json({ data: { ok: true, count: 0, skipped: 0 } });
      }
      const section =
        new URL(String(url), 'https://instance.example.test').searchParams.get('section') ??
        'overview';
      return Response.json({ data: { ...server, section } });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderConsole = (data: Dashboard, tab = 'policy', revisionId?: string) => {
  server = data;
  window.history.replaceState(
    null,
    '',
    `/settings/system?section=sso&authTab=${tab}${revisionId ? `&revisionId=${revisionId}` : ''}`
  );
  return render(
    <AuthenticationConsole
      initialData={{ ...data, section: tab as Dashboard['section'] }}
      callbackUrl="https://instance.example.test/api/auth/callback/oidc"
      testCallbackUrl="https://instance.example.test/api/auth/oidc/test/callback"
    />
  );
};

describe('revision selection reconciliation', () => {
  const list = [
    revision('draft-new'),
    revision('active', { activatedAt: '2026-10-01T00:00:00.000Z' }),
    revision('verified', { verification: { ...required, state: 'valid' } }),
  ];
  it('keeps a requested revision that still exists', () => {
    expect(reconcileRevisionSelection(list, 'draft-new', 'active')).toBe('draft-new');
  });
  it('replaces a deleted revision with a valid proof, then the active, then the newest', () => {
    expect(reconcileRevisionSelection(list, 'deleted', 'active')).toBe('verified');
    expect(reconcileRevisionSelection(list.slice(0, 2), 'deleted', 'active')).toBe('active');
    expect(reconcileRevisionSelection(list.slice(0, 1), 'deleted', null)).toBe('draft-new');
  });
  it('clears the selection when no revisions remain', () => {
    expect(reconcileRevisionSelection([], 'deleted', null)).toBe('');
  });
});

describe('revision lifecycle in the console', () => {
  it('shows the server-derived proof state instead of inferring it from a timestamp', () => {
    renderConsole(
      dashboard({
        revisions: [
          revision('draft-1', {
            testedAt: '2026-10-01T00:00:00.000Z',
            verification: {
              state: 'expired',
              verifiedAt: '2026-10-01T00:00:00.000Z',
              expiresAt: '2026-10-08T00:00:00.000Z',
              adminUserId: 'admin',
            },
          }),
        ],
      })
    );
    expect(screen.getAllByText('Verification expired — retest').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Verified/)).not.toBeInTheDocument();
  });

  it('selects a valid remaining revision after deleting the selected draft', async () => {
    renderConsole(dashboard(), 'policy', 'draft-1');
    expect(screen.getByLabelText('Saved configuration to activate')).toHaveValue('draft-1');
    fireEvent.click(screen.getByRole('button', { name: /Delete draft/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Saved configuration to activate')).toHaveValue('draft-2')
    );
    expect(new URLSearchParams(window.location.search).get('revisionId')).toBe('draft-2');
  });

  it('never stages from a deleted source revision', async () => {
    renderConsole(dashboard(), 'connection', 'draft-1');
    // Another administrator deletes the selected draft; the next refresh must recover.
    server = { ...server, revisions: [revision('draft-2')] };
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sessions & Policies' }), { button: 0 });
    await waitFor(() =>
      expect(screen.getByLabelText('Saved configuration to activate')).toHaveValue('draft-2')
    );
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
  });

  it('bulk cleanup sends exactly the drafts the administrator confirmed', async () => {
    renderConsole(dashboard(), 'policy', 'draft-1');
    fireEvent.click(screen.getByRole('button', { name: /Delete 2 unused drafts/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete unused drafts' }));
    await waitFor(() =>
      expect(requests.some(body => body.action === 'cleanupRevisions')).toBe(true)
    );
    expect(requests.find(body => body.action === 'cleanupRevisions')).toEqual({
      action: 'cleanupRevisions',
      revisionIds: ['draft-1', 'draft-2'],
    });
  });
});

describe('administrator retest consent', () => {
  it('requires explicit consent when the administrator has no identity for the provider', async () => {
    renderConsole(
      dashboard({
        revisions: [
          revision('draft-1', {
            verification: {
              state: 'valid',
              verifiedAt: '2026-10-14T00:00:00.000Z',
              expiresAt: '2026-10-21T00:00:00.000Z',
              adminUserId: 'admin',
            },
          }),
        ],
      }),
      'policy',
      'draft-1'
    );
    const retest = screen.getByRole('button', { name: 'Retest administrator sign-in' });
    // A previous successful test never implies consent for the next one.
    expect(retest).toBeDisabled();
    expect(retest).toHaveAccessibleDescription(/Allow linking below to test/);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Allow this SSO identity to link to the selected existing OpsKnight administrator/,
      })
    );
    expect(retest).toBeEnabled();
    fireEvent.click(retest);
    await waitFor(() => expect(requests.some(body => body.action === 'test')).toBe(true));
    expect(requests.find(body => body.action === 'test')).toMatchObject({ linkApproved: true });
  });

  it('retests an already-linked administrator without creating a new link', async () => {
    renderConsole(
      dashboard({
        users: [{ ...admin, issuers: [configuration.issuer] }],
        activeProvider: configuration,
      }),
      'policy',
      'draft-1'
    );
    expect(
      screen.queryByRole('checkbox', { name: /Allow this SSO identity to link/ })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test administrator sign-in' }));
    await waitFor(() => expect(requests.some(body => body.action === 'test')).toBe(true));
    expect(requests.find(body => body.action === 'test')).toMatchObject({ linkApproved: false });
  });
});
