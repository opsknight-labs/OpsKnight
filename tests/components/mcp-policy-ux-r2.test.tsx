import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpPolicyForm from '@/components/settings/mcp/McpPolicyForm';
import McpPolicySection from '@/components/settings/mcp/sections/McpPolicySection';

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const policy = {
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
  allowedBrowserOrigins: [],
  scopeStepUpEnabled: false,
  patEnabled: false,
  patMaxDays: 30,
  patAllowedScopes: [],
  requireReadOnlyConnections: false,
};

function section() {
  return render(
    <McpPolicySection
      policy={policy}
      revision={0}
      scopeChoices={['incidents:read']}
      selectedScopes={['incidents:read']}
      action={vi.fn()}
    />
  );
}

it('UX-9: reviewed actions sit on the page, not inside the collapsed Advanced section', () => {
  section();
  const reviewed = screen.getByRole('group', { name: 'Reviewed actions' });
  expect(reviewed.closest('details')).toBeNull();
  expect(screen.getByRole('checkbox', { name: /Allow reviewed routine mutations/ })).toBeTruthy();
  // Advanced keeps only hosts and limits; its inputs stay rendered so the form still submits them.
  const advanced = screen.getByText('Advanced').closest('details')!;
  expect(advanced.open).toBe(false);
  expect(advanced.textContent).not.toContain('Reviewed');
  expect(advanced.querySelector('input[name="maxInFlight"]')).not.toBeNull();
});

it('UX-9: a refused field inside the closed Advanced section opens it instead of failing silently', () => {
  section();
  const advanced = screen.getByText('Advanced').closest('details')!;
  const field = advanced.querySelector<HTMLInputElement>('input[name="maxInFlight"]')!;
  fireEvent.change(field, { target: { value: '' } });
  expect(field.checkValidity()).toBe(false);
  expect(advanced.open).toBe(true);
});

function form(action = vi.fn().mockResolvedValue({ ok: true, revision: 2 })) {
  render(
    <>
      <a href="/settings/integrations/mcp?tab=overview">Overview tab</a>
      <McpPolicyForm action={action} revision={1}>
        <input aria-label="Scopes" name="dcrScopes" defaultValue="incidents:read" />
      </McpPolicyForm>
    </>
  );
  return action;
}

function beforeUnloadBlocked() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it('UX-13: asks before leaving with unsaved edits, and lets the edit be kept', () => {
  form();
  // Stands in for the router: counts link clicks that reached the document unblocked.
  const leaving = vi.fn();
  const navigate = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return;
    event.preventDefault();
    leaving();
  };
  document.addEventListener('click', navigate);
  try {
    // Nothing edited: links and reloads go straight through.
    expect(beforeUnloadBlocked()).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Overview tab' }));
    expect(leaving).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Leave with unsaved changes?')).toBeNull();

    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'services:read' } });
    expect(beforeUnloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Overview tab' }));
    expect(leaving).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Leave with unsaved changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Scopes')).toHaveValue('services:read');
    expect(leaving).toHaveBeenCalledTimes(1);

    // Discarding replays the original link.
    fireEvent.click(screen.getByRole('link', { name: 'Overview tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
    expect(leaving).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener('click', navigate);
  }
});

it('UX-13: a successful save clears the warning', async () => {
  const action = form();
  fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'services:read' } });
  expect(beforeUnloadBlocked()).toBe(true);
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Save policy' }).closest('form')!);
  });
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(beforeUnloadBlocked()).toBe(false));
});
