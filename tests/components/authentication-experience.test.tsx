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
beforeEach(() =>
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
  )
);
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
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push(body);
        if (body.action === 'stage') return Response.json({ data: { revisionId: 'staged' } });
        if (body.action === 'preview')
          return Response.json({
            data: {
              policyVersion: 1,
              adminVerified: true,
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
    await screen.findByText('Real administrator login: verified');
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
    if (issuer.includes('login.microsoftonline.com/')) {
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
});
