import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { providerConfigSchema } from '@/lib/auth-control/provider-config';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import AuthenticationActionGuard, {
  actionAvailability,
} from '@/components/settings/authentication/AuthenticationActionGuard';
import { Button } from '@/components/ui/shadcn/button';
import { fixtureDashboard } from '../helpers/authentication-dashboard';
import { notify as toast } from '@/lib/toast';

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings/system',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const renderConsole = (
  tab = 'connection',
  data: Awaited<ReturnType<typeof authenticationDashboard>> = fixtureDashboard
) => {
  window.history.replaceState(null, '', `/settings/system?section=sso&authTab=${tab}`);
  return render(
    <AuthenticationConsole
      initialData={{ ...data, section: tab as typeof data.section }}
      callbackUrl="https://instance.example.test/api/auth/callback/oidc"
      testCallbackUrl="https://instance.example.test/api/auth/oidc/test/callback"
    />
  );
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      Response.json({
        data: {
          ...fixtureDashboard,
          section:
            new URL(String(url), 'https://instance.example.test').searchParams.get('section') ??
            'overview',
        },
      })
    )
  );
});
afterEach(() => vi.unstubAllGlobals());
describe('enterprise authentication experience', () => {
  it('makes action prerequisites both visible and associated with the disabled button', () => {
    render(
      <AuthenticationActionGuard
        availability={actionAvailability('Activate', [
          { code: 'test', message: 'Complete a real sign-in first.' },
        ])}
      >
        <Button>Activate</Button>
      </AuthenticationActionGuard>
    );
    const button = screen.getByRole('button', { name: 'Activate' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Complete a real sign-in first.');
  });
  it('stages cross-tab edits from the shared draft and exposes validation at their source', async () => {
    renderConsole();
    fireEvent.change(screen.getByLabelText('Client ID', { exact: true }), {
      target: { value: 'cross-tab-client' },
    });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Access & provisioning' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(screen.getByLabelText(/Allowed domains/), {
      target: { value: 'example.test, ' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stage configuration' })).toBeEnabled()
    );
    expect(screen.getByLabelText(/Allowed domains/)).toHaveValue('example.test, ');
    fireEvent.change(screen.getByLabelText(/Allowed domains/), {
      target: { value: 'example.test, second.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stage configuration' }));
    expect(screen.getByText('Resolve these fields before staging:')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Enter a client secret for this provider and client.' })
    ).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Identity Provider' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByLabelText('Client ID', { exact: true })).toHaveValue('cross-tab-client');
    expect(new URLSearchParams(window.location.search).get('section')).toBe('sso');
  });
  it('confirms a provider switch, clears incompatible fields and only shows Auth0 organization for Auth0', () => {
    renderConsole();
    fireEvent.change(screen.getByLabelText('Client ID', { exact: true }), {
      target: { value: 'google-client' },
    });
    fireEvent.change(screen.getByLabelText('Identity provider', { exact: true }), {
      target: { value: 'auth0' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Change provider/ }));
    expect(screen.getByLabelText('Client ID', { exact: true })).toHaveValue('');
    fireEvent.click(screen.getByText('Advanced provider settings'));
    expect(screen.getByLabelText(/Auth0 Organization ID/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Identity provider', { exact: true }), {
      target: { value: 'azure' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Change provider/ }));
    expect(screen.queryByLabelText(/Auth0 Organization ID/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Directory \(tenant\) ID/)).toBeInTheDocument();
  });
  it('offers inherited session defaults and corrects a shorter maximum without hidden overrides', () => {
    renderConsole('policy');
    fireEvent.change(screen.getByLabelText('Maximum session lifetime', { exact: true }), {
      target: { value: '3600' },
    });
    fireEvent.change(screen.getByLabelText('Idle timeout', { exact: true }), {
      target: { value: '7200' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Shorten the idle timeout');
    fireEvent.click(screen.getByRole('button', { name: 'Match idle timeout to maximum lifetime' }));
    expect(screen.getByLabelText('Idle timeout', { exact: true })).toHaveValue('3600');
  });
  it('allows canceling discard and restores every shared field only after confirmation', () => {
    renderConsole();
    fireEvent.change(screen.getByLabelText('Client ID', { exact: true }), {
      target: { value: 'changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Client ID', { exact: true })).toHaveValue('changed');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft changes' }));
    expect(screen.getByLabelText('Client ID', { exact: true })).toHaveValue('');
  });
  it('blocks a stale draft and reloads the complete active configuration after confirmation', async () => {
    const configuration = providerConfigSchema.parse({
      issuer: 'https://accounts.google.com',
      clientId: 'original-client',
      clientSecret: '',
      providerType: 'google',
    });
    const original = {
      ...fixtureDashboard,
      providerConfigVersion: 2,
      activeProvider: { ...configuration, hasClientSecret: true },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            ...original,
            section: 'access',
            providerConfigVersion: 3,
            activeProvider: { ...original.activeProvider, clientId: 'remote-client' },
          },
        })
      )
    );
    renderConsole('connection', original);
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'local-change' } });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Access & provisioning' }), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByRole('button', { name: 'Reload active configuration' });
    expect(screen.getByRole('button', { name: 'Stage configuration' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload active configuration' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace draft with active configuration' })
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Identity Provider' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByLabelText('Client ID')).toHaveValue('remote-client');
  });
  it('activates then immediately edits and stages against the committed provider version', async () => {
    const configuration = providerConfigSchema.parse({
      providerType: 'google',
      issuer: 'https://accounts.google.com',
      clientId: 'google-client',
      clientSecret: '',
    });
    let version = 1;
    const calls: Array<Record<string, unknown>> = [];
    const validProof = {
      state: 'valid',
      verifiedAt: '2026-10-15T00:00:00.000Z',
      expiresAt: '2026-10-22T00:00:00.000Z',
      adminUserId: 'admin',
    };
    // Like the real server, a staged revision is listed (with its verified proof) afterwards.
    let revisions: unknown[] = [];
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push(body);
        if (body.action === 'stage') {
          revisions = [
            {
              id: 'staged',
              baseConfigVersion: version,
              configuration: { ...configuration, hasClientSecret: true },
              createdAt: '2026-10-15T00:00:00.000Z',
              discoveryVerifiedAt: '2026-10-15T00:00:00.000Z',
              activatedAt: null,
              previousRevisionId: null,
              testedAt: '2026-10-15T00:00:00.000Z',
              testedAdminId: 'admin',
              createdByLabel: 'admin@example.test',
              verification: validProof,
            },
          ];
          return Response.json({ data: { revisionId: 'staged' } });
        }
        if (body.action === 'preview')
          return Response.json({
            data: {
              policyVersion: 1,
              adminVerified: true,
              verification: validProof,
              blockers: [],
              passwordSessionCount: 0,
              usersRequiringLinking: 0,
              verifiedEmergencyAccounts: 2,
            },
          });
        if (body.action === 'activate') {
          version = 2;
          return Response.json({
            data: { mode: 'SSO_OPTIONAL', version: 2, providerConfigVersion: 2 },
          });
        }
      }
      return Response.json({
        data: {
          ...fixtureDashboard,
          section: new URL(String(url), 'https://instance.example.test').searchParams.get(
            'section'
          ),
          providerConfigVersion: version,
          activeProvider: { ...configuration, hasClientSecret: true },
          revisions,
        },
      });
    });
    vi.stubGlobal('fetch', request);
    renderConsole('connection', {
      ...fixtureDashboard,
      providerConfigVersion: 1,
      activeProvider: { ...configuration, hasClientSecret: true },
    });
    fireEvent.change(screen.getByLabelText('Provider display name'), {
      target: { value: 'First draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stage configuration' }));
    await screen.findByText(/Changes staged and discovery verified/);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sessions & Policies' }), { button: 0 });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview enforcement impact' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview enforcement impact' }));
    await screen.findByText('Enforcement impact summary');
    expect(screen.getAllByText(/Verified — expires/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the impact/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate verified SSO' }));
    await screen.findByText(/Verified SSO activated/);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Identity Provider' }), { button: 0 });
    await waitFor(() => expect(screen.getByLabelText('Provider display name')).toBeEnabled());
    expect(screen.getByLabelText('Provider display name')).toHaveValue('First draft');
    fireEvent.change(screen.getByLabelText('Provider display name'), {
      target: { value: 'Second draft' },
    });
    expect(
      screen.queryByRole('button', { name: 'Reload active configuration' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stage configuration' }));
    await waitFor(() => expect(calls.filter(call => call.action === 'stage')).toHaveLength(2));
    expect(
      calls.filter(call => call.action === 'stage').map(call => call.expectedConfigVersion)
    ).toEqual([1, 2]);
  });
  it.each([
    'https://login.microsoftonline.com/tenant-one/v2.0',
    'https://login.microsoftonline.us/tenant-one/v2.0',
    'https://login.partner.microsoftonline.cn/tenant-one/v2.0',
    'https://authority.example.test/tenant-one/v2.0',
  ])('presents an existing Entra authority without a blank tenant: %s', issuer => {
    const configuration = providerConfigSchema.parse({
      providerType: 'azure',
      issuer,
      clientId: 'entra-client',
      clientSecret: '',
    });
    renderConsole('connection', {
      ...fixtureDashboard,
      activeProvider: { ...configuration, hasClientSecret: true },
    });
    if (new URL(issuer).hostname === 'login.microsoftonline.com') {
      expect(screen.getByLabelText(/Directory \(tenant\) ID/)).toHaveValue('tenant-one');
    } else {
      expect(screen.getByLabelText('Exact issuer', { exact: true })).toHaveValue(issuer);
      expect(screen.queryByLabelText(/Directory \(tenant\) ID/)).not.toBeInTheDocument();
    }
  });
  it.each([null, 3600])(
    'restores duration selection after discarding custom edits (saved %s)',
    saved => {
      const configuration = providerConfigSchema.parse({
        providerType: 'google',
        issuer: 'https://accounts.google.com',
        clientId: 'google-client',
        clientSecret: '',
        sessionMaxAgeSeconds: saved,
      });
      renderConsole('policy', {
        ...fixtureDashboard,
        activeProvider: { ...configuration, hasClientSecret: true },
      });
      fireEvent.change(screen.getByLabelText('Maximum session lifetime', { exact: true }), {
        target: { value: 'custom' },
      });
      fireEvent.change(screen.getByLabelText('Maximum session lifetime custom value'), {
        target: { value: '5' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft changes' }));
      expect(screen.getByLabelText('Maximum session lifetime', { exact: true })).toHaveValue(
        saved === null ? 'default' : String(saved)
      );
      expect(
        screen.queryByLabelText('Maximum session lifetime custom value')
      ).not.toBeInTheDocument();
    }
  );
  it('loads saved session defaults after editing a custom duration', async () => {
    const configuration = providerConfigSchema.parse({
      providerType: 'google',
      issuer: 'https://accounts.google.com',
      clientId: 'google-client',
      clientSecret: '',
    });
    const data = {
      ...fixtureDashboard,
      activeProvider: { ...configuration, hasClientSecret: true },
      revisions: [
        {
          id: 'saved-defaults',
          baseConfigVersion: 0,
          configuration: { ...configuration, hasClientSecret: true },
          createdAt: '2026-10-15T00:00:00Z',
          activatedAt: null,
          discoveryVerifiedAt: null,
          testedAt: '',
          testedAdminId: '',
          previousRevisionId: null,
          createdByLabel: 'admin@example.test',
          verification: {
            state: 'required' as const,
            verifiedAt: null,
            expiresAt: null,
            adminUserId: null,
          },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        Response.json({
          data: {
            ...data,
            section: new URL(String(url), 'https://instance.example.test').searchParams.get(
              'section'
            ),
          },
        })
      )
    );
    renderConsole('policy', data);
    fireEvent.change(screen.getByLabelText('Maximum session lifetime', { exact: true }), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByLabelText('Maximum session lifetime custom value'), {
      target: { value: '5' },
    });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Identity Provider' }), { button: 0 });
    await waitFor(() =>
      expect(screen.getByLabelText('Saved provider configuration')).toBeEnabled()
    );
    fireEvent.change(screen.getByLabelText('Saved provider configuration'), {
      target: { value: 'saved-defaults' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load saved configuration' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sessions & Policies' }), { button: 0 });
    await waitFor(() =>
      expect(screen.getByLabelText('Maximum session lifetime', { exact: true })).toHaveValue(
        'default'
      )
    );
    expect(
      screen.queryByLabelText('Maximum session lifetime custom value')
    ).not.toBeInTheDocument();
  });
  it('explains how to leave SSO Required instead of only greying out SSO Optional', () => {
    renderConsole('policy', { ...fixtureDashboard, mode: 'SSO_REQUIRED' });
    expect(screen.getByRole('option', { name: /SSO Optional — use/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to SSO Optional' }));
    const panel = document.getElementById('auth-policy-mode-change') as HTMLDetailsElement;
    expect(panel.open).toBe(true);
    expect(within(panel).getByRole('combobox', { name: /New authentication mode/ })).toHaveValue(
      'SSO_OPTIONAL'
    );
  });
  it('lets an emergency recovery session step SSO Required back to SSO Optional only', async () => {
    const posted: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)));
          return Response.json({ data: { mode: 'SSO_OPTIONAL', version: 2 } });
        }
        return Response.json({
          data: {
            ...fixtureDashboard,
            mode: 'SSO_REQUIRED',
            actor: { kind: 'emergency', id: 'recovery-1' },
            section: new URL(String(url), 'https://instance.example.test').searchParams.get(
              'section'
            ),
          },
        });
      })
    );
    renderConsole('policy', {
      ...fixtureDashboard,
      mode: 'SSO_REQUIRED',
      actor: { kind: 'emergency', id: 'recovery-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to SSO Optional' }));
    const panel = document.getElementById('auth-policy-mode-change') as HTMLDetailsElement;
    expect(panel.open).toBe(true);
    const select = within(panel).getByRole('combobox', { name: /New authentication mode/ });
    expect(within(select).queryByRole('option', { name: 'Password Only' })).toBeNull();
    expect(within(panel).queryByPlaceholderText(/current administrator password/)).toBeNull();
    fireEvent.click(within(panel).getByRole('checkbox', { name: /I confirm this deliberate/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Change authentication mode' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ action: 'mode', mode: 'SSO_OPTIONAL' });
  });
  it('protects unstaged changes when leaving through an outer settings tab', () => {
    renderConsole();
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'unsaved' } });
    const event = new CustomEvent('opsknight:settings-navigation', {
      cancelable: true,
      detail: { parameter: 'section', value: 'retention' },
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Leave with unstaged changes?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Client ID')).toHaveValue('unsaved');
  });
  it('keeps a rejected recovery action open and announces its error inside the dialog', async () => {
    const account = {
      id: 'recovery-one',
      displayName: 'Custodian One',
      authenticationMethod: 'PASSWORD',
      credentialVersion: 1,
      status: 'ACTIVE',
      verifiedAt: null,
      lastUsedAt: null,
      ready: false,
      credentials: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Recovery change denied' }, { status: 403 }))
    );
    renderConsole('emergency', { ...fixtureDashboard, emergencyAccounts: [account] });
    fireEvent.click(screen.getByRole('button', { name: /Manage.*Custodian One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate password' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand the session revocation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm recovery change' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Recovery change denied'
    );
    expect(screen.getByRole('button', { name: 'Confirm recovery change' })).toBeEnabled();
  });
  it('keeps compromise confirmation scoped to exactly one destructive recovery action', () => {
    const account = {
      id: 'recovery-one',
      displayName: 'Custodian One',
      authenticationMethod: 'PASSWORD' as const,
      credentialVersion: 1,
      status: 'ACTIVE' as const,
      verifiedAt: null,
      lastUsedAt: null,
      ready: false,
      credentials: [],
    };
    renderConsole('emergency', { ...fixtureDashboard, emergencyAccounts: [account] });
    fireEvent.click(screen.getByRole('button', { name: /Manage.*Custodian One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate password' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /confirmed compromised/ }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dialog' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Manage.*Custodian One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable identity' }));
    expect(screen.getByRole('checkbox', { name: /confirmed compromised/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Confirm recovery change' })).toBeDisabled();
  });

  it('surfaces action errors in the top-right toast notification banner when password verification or staging fails', async () => {
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === 'mode') {
          return new Response(
            JSON.stringify({ error: 'Verify your current password before disabling SSO.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      return Response.json({
        data: {
          ...fixtureDashboard,
          section:
            new URL(String(url), 'https://instance.example.test').searchParams.get('section') ??
            'policy',
        },
      });
    });
    vi.stubGlobal('fetch', request);
    renderConsole('policy', {
      ...fixtureDashboard,
      mode: 'SSO_OPTIONAL',
    });

    // Attempt to change authentication mode to PASSWORD_ONLY
    const details = screen.getByText('Change to Password Only or SSO Optional').closest('details');
    expect(details).toBeDefined();
    if (details) details.open = true;

    // Check confirmation checkbox
    const confirmCheckbox = screen.getByRole('checkbox', {
      name: /I confirm this deliberate sign-in policy change/i,
    });
    fireEvent.click(confirmCheckbox);

    // Enter password and click change
    const passwordInput = screen.getByPlaceholderText('Enter your current administrator password');
    fireEvent.change(passwordInput, { target: { value: 'wrong-pass' } });

    const changeButton = screen.getByRole('button', { name: /Change authentication mode/i });
    fireEvent.click(changeButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Action could not complete', {
        description: 'Verify your current password before disabling SSO.',
      });
    });

    // Inline alert remains visible as well
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Verify your current password before disabling SSO.'
    );
  });

  it('surfaces successful updates in the top-right toast notification banner on staging draft', async () => {
    let staged = false;
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === 'stage') {
          staged = true;
          return Response.json({ data: { revisionId: 'rev-staged-1' } });
        }
      }
      return Response.json({
        data: {
          ...fixtureDashboard,
          section: 'connection',
          revisions: staged
            ? [
                {
                  id: 'rev-staged-1',
                  baseConfigVersion: 1,
                  configuration: {
                    issuer: 'https://accounts.google.com',
                    clientId: 'new-client-id',
                    clientSecret: '',
                    hasClientSecret: true,
                    enabled: true,
                    autoProvision: false,
                    allowedDomains: [],
                    roleMapping: [],
                    customScopes: null,
                    providerType: 'google' as const,
                    providerLabel: null,
                    organizationId: null,
                    tokenEndpointAuthMethod: 'client_secret_basic' as const,
                    profileMapping: {},
                    sessionMaxAgeSeconds: null,
                    sessionIdleTimeoutSeconds: null,
                  },
                  createdAt: '2026-10-15T00:00:00.000Z',
                  discoveryVerifiedAt: '2026-10-15T00:00:00.000Z',
                  activatedAt: null,
                  previousRevisionId: null,
                  testedAt: null,
                  testedAdminId: null,
                  createdByLabel: 'admin@example.test',
                  verification: { state: 'required' as const },
                },
              ]
            : [],
        },
      });
    });
    vi.stubGlobal('fetch', request);
    renderConsole('connection', {
      ...fixtureDashboard,
      activeProvider: {
        issuer: 'https://accounts.google.com',
        clientId: 'original-client',
        clientSecret: '',
        hasClientSecret: true,
        enabled: true,
        autoProvision: false,
        allowedDomains: [],
        roleMapping: [],
        customScopes: null,
        providerType: 'google',
        providerLabel: null,
        organizationId: null,
        tokenEndpointAuthMethod: 'client_secret_basic',
        profileMapping: {},
        sessionMaxAgeSeconds: null,
        sessionIdleTimeoutSeconds: null,
      },
    });

    // Make an edit to clientId and provide clientSecret
    const clientInput = screen.getByRole('textbox', { name: /Client ID/i });
    fireEvent.change(clientInput, { target: { value: 'new-client-id' } });
    const secretInput = screen.getByLabelText(/Client secret/i);
    fireEvent.change(secretInput, { target: { value: 'super-secret' } });

    // Click Stage configuration
    const stageButton = screen.getByRole('button', { name: 'Stage configuration' });
    fireEvent.click(stageButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Authentication update', {
        description:
          'Changes staged and discovery verified. Test administrator sign-in before activation.',
      });
    });

    // Inline status remains visible as well
    expect(screen.getByRole('status')).toHaveTextContent(
      'Changes staged and discovery verified. Test administrator sign-in before activation.'
    );
  });
});

it('distinguishes the first-identity empty-state action from the persistent creation action', () => {
  renderConsole('emergency', { ...fixtureDashboard, emergencyAccounts: [] });
  expect(screen.getByRole('button', { name: 'Create emergency identity' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create first emergency identity' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Create first emergency identity' }));
  expect(screen.getByRole('dialog', { name: 'Create emergency identity' })).toBeVisible();
});
