import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ConsentForm from '@/app/oauth/mcp/consent/ConsentForm';
import McpPersonalTokenForm from '@/components/settings/mcp/McpPersonalTokenForm';
import McpConnectionsSection from '@/components/settings/mcp/sections/McpConnectionsSection';
import McpPolicySection from '@/components/settings/mcp/sections/McpPolicySection';
import type { McpGrantRow } from '@/app/(app)/settings/integrations/mcp/queries';
import type { McpPatCreateResult } from '@/lib/mcp/auth/personal-tokens';

const refresh = vi.fn();
const signOut = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ signOut: (...args: unknown[]) => signOut(...args) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const tokenForm = (action: (form: FormData) => Promise<McpPatCreateResult>) =>
  render(
    <McpPersonalTokenForm
      action={action}
      scopeChoices={[
        { scope: 'incidents:read', label: 'View incidents' },
        { scope: 'incidents:write', label: 'Change incidents' },
      ]}
      expiryChoices={[7, 30]}
      defaultDays={30}
      returnPath="/settings/integrations/mcp?tab=connections"
    />
  );

it('PAT form: submits label, chosen scopes and expiry, then shows the token once', async () => {
  const action = vi.fn<(form: FormData) => Promise<McpPatCreateResult>>().mockResolvedValue({
    ok: true,
    token: 'okmcp_pat_secret-value-1234567890abcdefghijkl',
    grantId: 'g1',
    scopes: ['incidents:read'],
    expiresAt: new Date(),
  });
  tokenForm(action);
  // Reads start ticked; change permissions are a deliberate choice.
  expect(screen.getByRole('checkbox', { name: /View incidents/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Change incidents/ })).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CI bot' } });
  fireEvent.change(screen.getByLabelText('Expires after'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  const form = action.mock.calls[0]![0];
  expect(form.get('label')).toBe('CI bot');
  expect(form.getAll('scopes')).toEqual(['incidents:read']);
  expect(form.get('expiresInDays')).toBe('7');
  expect(await screen.findByText('Copy your token now')).toBeVisible();
  expect(screen.getByText('okmcp_pat_secret-value-1234567890abcdefghijkl')).toBeVisible();
  expect(screen.getByRole('button', { name: /copy/i })).toBeVisible();
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

it('PAT form: a stale sign-in offers to confirm it is you and come back', async () => {
  const action = vi
    .fn<(form: FormData) => Promise<McpPatCreateResult>>()
    .mockResolvedValue({ ok: false, code: 'MCP_REAUTHENTICATION_REQUIRED' });
  tokenForm(action);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CI bot' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  fireEvent.click(await screen.findByRole('button', { name: "Confirm it's you" }));
  expect(signOut).toHaveBeenCalledWith({
    callbackUrl: `/login?callbackUrl=${encodeURIComponent('/settings/integrations/mcp?tab=connections')}`,
  });
  expect(screen.queryByText('Copy your token now')).toBeNull();
});

it('consent: "View only" leaves every change permission out of the submitted form', async () => {
  const action = vi.fn<(form: FormData) => Promise<void>>().mockResolvedValue(undefined);
  render(
    <ConsentForm
      action={action}
      requestId="r1"
      clientName="Claude"
      groups={[
        {
          id: 'incidents',
          label: 'Incidents',
          view: [{ scope: 'incidents:read', label: 'View incidents', checked: true }],
          change: [{ scope: 'incidents:write', label: 'Change incidents', checked: true }],
        },
      ]}
      unavailableNote={null}
      wide={false}
    />
  );
  const viewOnly = screen.getByRole('switch', { name: /View only/ });
  // Off by default.
  expect(viewOnly).not.toBeChecked();
  expect(screen.getByText('2 of 2 selected')).toBeVisible();
  fireEvent.click(viewOnly);
  const change = screen.getByRole('checkbox', { name: /Change incidents/ });
  expect(change).toBeDisabled();
  expect(change).not.toBeChecked();
  expect(screen.getByText('1 of 1 selected')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  const form = action.mock.calls[0]![0];
  expect(form.getAll('scope')).toEqual(['incidents:read']);
  expect(form.get('viewOnly')).toBe('on');
});

it('consent: "View only" on a request for changes only keeps the switch so it can be undone', () => {
  render(
    <ConsentForm
      action={vi.fn()}
      requestId="r1"
      clientName="Claude"
      groups={[
        {
          id: 'incidents',
          label: 'Incidents',
          view: [],
          change: [{ scope: 'incidents:write', label: 'Change incidents', checked: true }],
        },
      ]}
      unavailableNote={null}
      wide={false}
    />
  );
  fireEvent.click(screen.getByRole('switch', { name: /View only/ }));
  // Not the "your role can't use any of these" refusal: the switch is still there to turn off.
  expect(screen.queryByText(/Your role can.t use any/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
  expect(screen.getByText(/asked for changes only/)).toBeVisible();
  fireEvent.click(screen.getByRole('switch', { name: /View only/ }));
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
});

it('consent: no "View only" switch when nothing could change anything', () => {
  render(
    <ConsentForm
      action={vi.fn()}
      requestId="r1"
      clientName="Claude"
      groups={[
        {
          id: 'incidents',
          label: 'Incidents',
          view: [{ scope: 'incidents:read', label: 'View incidents', checked: true }],
          change: [],
        },
      ]}
      unavailableNote={null}
      wide={false}
    />
  );
  expect(screen.queryByRole('switch', { name: /View only/ })).toBeNull();
});

const grantRow = (overrides: Partial<McpGrantRow>): McpGrantRow => ({
  id: 'g1',
  kind: 'oauth',
  label: null,
  scopes: ['incidents:read'],
  effectiveScopes: ['incidents:read'],
  blockedReason: null,
  status: 'active',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  lastUsedAt: null,
  lastCallAt: new Date('2026-11-04T00:00:00Z'),
  lastTool: 'incident_search',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  revokedAt: null,
  user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
  client: { id: 'c1', name: 'Claude', type: 'automatic', metadataHost: null, revoked: false },
  ...overrides,
});

it('connections: personal tokens show their name, a type badge, expiry and last call', () => {
  render(
    <McpConnectionsSection
      isAdmin={false}
      rows={[
        grantRow({}),
        grantRow({
          id: 'g2',
          kind: 'pat',
          label: 'Nightly CI',
          client: {
            id: 'okmcp-personal-access-tokens',
            name: 'Personal access token',
            type: 'manual',
            metadataHost: null,
            revoked: false,
          },
        }),
        grantRow({
          id: 'g3',
          kind: 'pat',
          label: 'Old bot',
          blockedReason: 'client_untrusted',
        }),
      ]}
      counts={{ active: 3, expired: 0, revoked: 0, all: 3 }}
      total={3}
      page={1}
      status="active"
      q=""
      client={null}
      now={new Date('2026-11-05T00:00:00Z')}
      timeZone="UTC"
      describeScope={scope => scope}
      revokeAction={vi.fn()}
      revokeAllAction={vi.fn()}
      personalTokens={<p>token panel</p>}
    />
  );
  expect(screen.getByText('token panel')).toBeVisible();
  const table = screen.getByRole('table');
  expect(within(table).getByText('Nightly CI')).toBeVisible();
  expect(within(table).getAllByText('Personal token')).toHaveLength(2);
  expect(within(table).getByText('OAuth')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Revoke connection for Nightly CI' })).toBeVisible();
  // A token blocked because tokens are off says so, not "this assistant is untrusted".
  expect(
    within(table).getByText(/Personal access tokens are turned off in the access policy/)
  ).toBeInTheDocument();
});

it('policy: personal tokens and view-only connections are explicit, off by default', () => {
  const { container } = render(
    <McpPolicySection
      policy={{
        enabled: true,
        dcrEnabled: true,
        dcrScopes: ['incidents:read'],
        sessionIdleDays: 30,
        writesEnabled: false,
        sensitiveReadsEnabled: false,
        cimdAllowedHosts: [],
        maxInFlight: 4,
        maxOperations: 8,
        requestsPerMinute: 60,
        approvalTtlMinutes: 240,
        approvalCommitWindowMinutes: 30,
        patEnabled: false,
        patMaxDays: 30,
        patAllowedScopes: ['incidents:read'],
        requireReadOnlyConnections: false,
        allowedBrowserOrigins: [],
        scopeStepUpEnabled: false,
      }}
      revision={0}
      scopeChoices={['incidents:read', 'incidents:write', 'runbooks:execute']}
      selectedScopes={['incidents:read']}
      action={vi.fn()}
    />
  );
  expect(screen.getByRole('checkbox', { name: /Allow personal access tokens/ })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Require view-only connections/ })).not.toBeChecked();
  expect(screen.getByLabelText('Longest allowed expiry (days)')).toHaveAttribute('max', '90');
  const allowed = [
    ...container.querySelectorAll<HTMLInputElement>('input[name="patAllowedScopes"]'),
  ].map(input => [input.value, input.checked]);
  // runbooks:execute is never offered for a token.
  expect(allowed).toEqual([
    ['incidents:read', true],
    ['incidents:write', false],
  ]);
  expect(container.querySelector('input[name="patControls"]')).not.toBeNull();
});
