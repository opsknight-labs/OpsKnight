import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import McpScopeSummary from '@/components/settings/mcp/McpScopeSummary';
import McpPolicyForm, {
  MCP_POLICY_CONFLICT_MESSAGE,
} from '@/components/settings/mcp/McpPolicyForm';
import McpPolicySection from '@/components/settings/mcp/sections/McpPolicySection';
import {
  McpRegisterClientForm,
  McpRestoreClientButton,
} from '@/components/settings/mcp/McpClientForms';
import ConsentForm from '@/app/oauth/mcp/consent/ConsentForm';
import { notify } from '@/lib/toast';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('D1: needs the acknowledgement and then submits confirm=on', async () => {
  const action = vi.fn<(form: FormData) => Promise<void>>().mockResolvedValue(undefined);
  render(
    <McpConfirmAction
      action={action}
      fields={{}}
      acknowledgement="I understand this disconnects every assistant (3 connections)."
      label="Revoke all"
      title="Revoke all?"
      description="Everyone is disconnected."
      confirmLabel="Revoke all connections"
      successMessage="Revoked"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }));
  const confirm = screen.getByRole('button', { name: 'Revoke all connections' });
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /3 connections/ }));
  fireEvent.click(confirm);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  const form = action.mock.calls[0]![0];
  expect([...form.entries()]).toEqual([['confirm', 'on']]);
});

it('D3: shows "N of M usable" and strikes through what is no longer allowed', () => {
  render(
    <McpScopeSummary
      context="Claude for Jane"
      scopes={[
        { scope: 'incidents:read', label: 'View incidents' },
        { scope: 'services:read', label: 'View services' },
      ]}
      usable={['incidents:read']}
    />
  );
  const chip = screen.getByRole('button', { name: '1 of 2 usable for Claude for Jane. Show list' });
  fireEvent.click(chip);
  expect(screen.getByText('View services')).toHaveClass('line-through');
  expect(screen.getByText('View incidents')).not.toHaveClass('line-through');
  expect(screen.getAllByText('No longer allowed')).toHaveLength(1);
  expect(screen.queryByText('Role-gated')).not.toBeInTheDocument();
});

it('D4: sends the revision, adopts the saved one and shows a conflict with a reload', async () => {
  const action = vi
    .fn<
      (
        form: FormData
      ) => Promise<
        | { ok: true; revision: number }
        | { ok: false; code: 'MCP_POLICY_CONFLICT'; revision: number }
      >
    >()
    .mockResolvedValueOnce({ ok: true, revision: 8 })
    .mockResolvedValueOnce({ ok: false, code: 'MCP_POLICY_CONFLICT', revision: 9 });
  render(
    <McpPolicyForm action={action} revision={7}>
      <input aria-label="Scopes" name="dcrScopes" defaultValue="incidents:read" />
    </McpPolicyForm>
  );
  const form = screen.getByRole('button', { name: 'Save policy' }).closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(notify.success).toHaveBeenCalled());
  expect(action.mock.calls[0]![0].get('policyRevision')).toBe('7');
  fireEvent.submit(form);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[1]![0].get('policyRevision')).toBe('8');
  expect(await screen.findByText(MCP_POLICY_CONFLICT_MESSAGE)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reload policy' })).toBeVisible();
  expect(notify.success).toHaveBeenCalledTimes(1);
});

it('D5: policy groups are named once and described for assistive technology', () => {
  render(
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
      }}
      revision={0}
      scopeChoices={['incidents:read']}
      selectedScopes={['incidents:read']}
      action={vi.fn()}
    />
  );
  const group = screen.getByRole('group', { name: 'Sign-in sessions' });
  expect(group).toHaveAccessibleDescription('How long an unused connection stays signed in.');
  expect(screen.getByRole('group', { name: 'Assistant access' })).toHaveAccessibleDescription(
    /master switch/
  );
});

it('D5: consent locks both buttons while the decision is recorded', async () => {
  let finish!: () => void;
  const action = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
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
          change: [],
        } as never,
      ]}
      unavailableNote={null}
      wide={false}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(await screen.findByRole('button', { name: 'Connecting…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

it('D5: register shows the problem on its field, then the new client_id', async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, code: 'MCP_INVALID_REDIRECT', field: 'redirectUri' })
    .mockResolvedValueOnce({ ok: true, clientId: 'client-123' });
  render(
    <McpRegisterClientForm
      action={action}
      scopeChoices={['incidents:read']}
      defaultScopes={['incidents:read']}
    />
  );
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Tool' } });
  fireEvent.change(screen.getByLabelText('Exact redirect URI'), {
    target: { value: 'http://evil.example/cb' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Register client' }));
  const redirect = screen.getByLabelText('Exact redirect URI');
  await waitFor(() => expect(redirect).toHaveAttribute('aria-invalid', 'true'));
  expect(redirect).toHaveAccessibleDescription(/exact callback address/);
  // The typed value stays in place for correction.
  expect(redirect).toHaveValue('http://evil.example/cb');
  fireEvent.click(screen.getByRole('button', { name: 'Register client' }));
  expect(await screen.findByText('client-123')).toBeVisible();
  expect(notify.success).toHaveBeenCalledWith('Client registered', expect.anything());
});

it('D5: "Allow again" reports a failure inline and success with a toast', async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, code: 'MCP_CLIENT_NOT_FOUND' })
    .mockResolvedValueOnce({ ok: true, clientId: 'c1' });
  render(<McpRestoreClientButton action={action} id="c1" name="Cursor" />);
  fireEvent.click(screen.getByRole('button', { name: 'Allow Cursor again' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists');
  fireEvent.click(screen.getByRole('button', { name: 'Allow Cursor again' }));
  await waitFor(() =>
    expect(notify.success).toHaveBeenCalledWith('Cursor is allowed again', expect.anything())
  );
  expect(refresh).toHaveBeenCalled();
});
