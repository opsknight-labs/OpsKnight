import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpUsageSection from '@/components/settings/mcp/sections/McpUsageSection';
import McpPolicySection from '@/components/settings/mcp/sections/McpPolicySection';
import type { McpUsage } from '@/app/(app)/settings/integrations/mcp/usage';

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => cleanup());

const usage = (overrides: Partial<McpUsage> = {}): McpUsage => ({
  window: '24h',
  by: 'tool',
  since: '2026-11-05T00:00:00.000Z',
  rows: [
    {
      key: 'incident_search',
      label: 'incident_search',
      calls: 1200,
      failed: 6,
      errorRate: 0.005,
      p95Ms: 180,
    },
    { key: 'oncall_now', label: 'oncall_now', calls: 40, failed: 8, errorRate: 0.2, p95Ms: null },
  ],
  totals: { calls: 1240, failed: 14, errorRate: 0.0113, p95Ms: 210 },
  truncated: false,
  retentionDays: 30,
  ...overrides,
});
const exportAction = vi.fn();

describe('Usage tab', () => {
  it('shows totals, a row per group and a failure tone that follows the rate', () => {
    render(<McpUsageSection usage={usage()} q="" exportAction={exportAction} />);
    expect(screen.getByText('1,240')).toBeTruthy();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows.length).toBe(3); // header + two groups
    expect(within(table).getByText('incident_search')).toBeTruthy();
    expect(within(table).getByText('20.0%')).toBeTruthy();
    // A group with no timed calls has no latency to show.
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('links the window and grouping choices and marks the current ones', () => {
    render(
      <McpUsageSection
        usage={usage({ window: '7d', by: 'client' })}
        q=""
        exportAction={exportAction}
      />
    );
    const windowNav = screen.getByRole('navigation', { name: 'Time window' });
    expect(
      within(windowNav).getByRole('link', { name: 'Last 7 days' }).getAttribute('aria-current')
    ).toBe('true');
    expect(
      within(windowNav).getByRole('link', { name: 'Last 24 hours' }).getAttribute('href')
    ).toBe('/settings/integrations/mcp?tab=usage&by=client');
    const groupNav = screen.getByRole('navigation', { name: 'Group usage by' });
    expect(within(groupNav).getByRole('link', { name: 'By tool' }).getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=usage&window=7d'
    );
  });

  it('says so when the window is longer than the log is kept', () => {
    render(
      <McpUsageSection
        usage={usage({ window: '30d', retentionDays: 7 })}
        q=""
        exportAction={exportAction}
      />
    );
    expect(screen.getByRole('note').textContent).toMatch(/kept for 7 days/);
    cleanup();
    render(
      <McpUsageSection
        usage={usage({ window: '7d', retentionDays: 30 })}
        q=""
        exportAction={exportAction}
      />
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('explains an empty result differently with and without a search', () => {
    const empty = usage({ rows: [], totals: { calls: 0, failed: 0, errorRate: 0, p95Ms: null } });
    const { rerender } = render(<McpUsageSection usage={empty} q="" exportAction={exportAction} />);
    expect(screen.getByText(/No assistant has called OpsKnight/)).toBeTruthy();
    rerender(<McpUsageSection usage={empty} q="zzz" exportAction={exportAction} />);
    expect(screen.getByText(/matches that search/)).toBeTruthy();
  });

  it('exports the current view and reports a cut-off honestly', async () => {
    exportAction.mockResolvedValue({
      filename: 'x.csv',
      mimeType: 'text/csv',
      content: 'a',
      rows: 10000,
      truncated: true,
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    render(<McpUsageSection usage={usage()} q="oncall" exportAction={exportAction} />);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() =>
      expect(exportAction).toHaveBeenCalledWith({ window: '24h', q: 'oncall', format: 'csv' })
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/newest 10,000 rows/)
    );
  });
});

describe('Request log retention control', () => {
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
    deviceFlowEnabled: false,
  };
  const renderPolicy = (callLogRetentionDays?: number) =>
    render(
      <McpPolicySection
        policy={{ ...policy, ...(callLogRetentionDays ? { callLogRetentionDays } : {}) }}
        revision={1}
        scopeChoices={['incidents:read']}
        selectedScopes={['incidents:read']}
        action={vi.fn()}
      />
    );

  it('defaults to 30 days and offers 7 to 365', () => {
    renderPolicy();
    const input = screen.getByLabelText('Keep the request log for (days)') as HTMLInputElement;
    expect(input.value).toBe('30');
    expect([input.min, input.max, input.name]).toEqual(['7', '365', 'callLogRetentionDays']);
  });

  it('shows the stored value', () => {
    renderPolicy(90);
    expect(
      (screen.getByLabelText('Keep the request log for (days)') as HTMLInputElement).value
    ).toBe('90');
  });

  describe('Who may approve', () => {
    const renderWith = (extra: Record<string, unknown>, activeAdminCount?: number) =>
      render(
        <McpPolicySection
          policy={{ ...policy, ...extra }}
          revision={1}
          scopeChoices={['incidents:read']}
          selectedScopes={['incidents:read']}
          action={vi.fn()}
          activeAdminCount={activeAdminCount}
        />
      );

    it('is off by default and says it needs a second reviewer', () => {
      renderWith({});
      const box = screen.getByLabelText(/Require a different reviewer/) as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect(box.name).toBe('requireDistinctReviewer');
      // The marker lets an unticked box mean "off" instead of "not on this form".
      expect(document.querySelector('input[name="reviewControls"]')).not.toBeNull();
    });

    it('shows the stored value', () => {
      renderWith({ requireDistinctReviewer: true });
      expect(
        (screen.getByLabelText(/Require a different reviewer/) as HTMLInputElement).checked
      ).toBe(true);
    });

    it('warns that one administrator cannot get their own changes approved', () => {
      renderWith({ requireDistinctReviewer: true }, 1);
      expect(screen.getByRole('note').textContent).toMatch(/one active administrator/);
      cleanup();
      renderWith({ requireDistinctReviewer: true }, 3);
      expect(screen.queryByRole('note')).toBeNull();
      cleanup();
      renderWith({}, undefined);
      expect(screen.queryByRole('note')).toBeNull();
    });
  });
});
