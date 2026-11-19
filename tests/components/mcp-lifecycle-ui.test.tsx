import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpAssistantDetail from '@/components/settings/mcp/McpAssistantDetail';
import McpUserPanel from '@/components/settings/mcp/McpUserPanel';
import McpConnectEntry from '@/components/settings/mcp/McpConnectEntry';
import McpGrantList from '@/components/settings/mcp/McpGrantList';
import McpUsageChart, { usageBucketLabel } from '@/components/settings/mcp/McpUsageChart';
import McpAssistantsSection from '@/components/settings/mcp/sections/McpAssistantsSection';
import type { McpClientRow, McpGrantRow } from '@/app/(app)/settings/integrations/mcp/queries';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const now = new Date('2026-11-12T12:00:00Z');
const describeScope = (scope: string) => `Scope ${scope}`;
const noop = vi.fn(async () => {});
const activity = vi.fn(async () => ({ calls: [], next: null, changes: [], historyHref: null }));

function grant(overrides: Partial<McpGrantRow> = {}): McpGrantRow {
  return {
    id: 'g1',
    kind: 'oauth',
    label: null,
    scopes: ['incidents:read'],
    effectiveScopes: ['incidents:read'],
    blockedReason: null,
    status: 'active',
    createdAt: now,
    lastUsedAt: null,
    lastCallAt: new Date(now.getTime() - 60_000),
    lastTool: 'incident_search',
    expiresAt: new Date(now.getTime() + 86_400_000),
    revokedAt: null,
    user: { id: 'u1', name: 'Jane', email: 'jane@example.com' },
    client: {
      id: 'https://claude.ai/oauth/metadata.json',
      name: 'Claude',
      type: 'metadata',
      metadataHost: 'claude.ai',
      revoked: false,
    },
    ...overrides,
  };
}

function client(overrides: Partial<McpClientRow> = {}): McpClientRow {
  return {
    id: 'https://claude.ai/oauth/metadata.json',
    name: 'Claude',
    type: 'metadata',
    metadataHost: 'claude.ai',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    scopes: ['incidents:read'],
    effectiveScopes: ['incidents:read'],
    blockedReason: null,
    trusted: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    firstAuthorizedAt: new Date('2026-10-02T00:00:00Z'),
    revokedAt: null,
    activeConnections: 1,
    lastUsedAt: null,
    lastCallAt: null,
    restrictedCapabilities: 0,
    ...overrides,
  };
}

const usage = (['24h', '7d', '30d'] as const).map((window, index) => ({
  window,
  totals: { calls: (index + 1) * 10, failed: index, errorRate: 0, p95Ms: index ? 120 : null },
  rows: [
    {
      key: 'incident_search',
      label: 'incident_search',
      calls: 9,
      failed: 0,
      errorRate: 0,
      p95Ms: 1,
    },
  ],
}));

function detail(overrides: Partial<Parameters<typeof McpAssistantDetail>[0]> = {}) {
  return render(
    <McpAssistantDetail
      client={client()}
      connections={[grant()]}
      connectionsTotal={1}
      usage={usage}
      calls={[
        {
          id: 'call1',
          at: '2026-11-12T11:59:00.000Z',
          tool: 'incident_search',
          operationId: null,
          outcome: 'rate_limited',
          durationMs: 12,
          requestId: 'r1',
          errorCode: 'RATE_LIMITED',
          person: 'Jane',
        },
      ]}
      now={now}
      timeZone="UTC"
      describeScope={describeScope}
      revokeAction={noop}
      restoreAction={vi.fn(async () => ({ ok: true as const, clientId: 'x' }))}
      activityAction={activity}
      {...overrides}
    />
  );
}

describe('Assistant detail', () => {
  it('shows identity, trusted metadata host, registration and dates', () => {
    detail();
    expect(screen.getByRole('heading', { level: 1, name: 'Claude' })).toBeTruthy();
    expect(screen.getByText('claude.ai')).toBeTruthy();
    expect(screen.getByText('Trusted')).toBeTruthy();
    expect(screen.getByText(/HTTPS client metadata document/)).toBeTruthy();
    expect(screen.getByText('https://claude.ai/api/mcp/auth_callback')).toBeTruthy();
    expect(screen.getByRole('link', { name: /All assistants/ }).getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=assistants'
    );
  });

  it('says when the policy no longer trusts the metadata host', () => {
    detail({ client: client({ trusted: false, blockedReason: 'client_untrusted' }) });
    expect(screen.getByText('Not trusted')).toBeTruthy();
    expect(screen.getByText('Blocked by policy')).toBeTruthy();
  });

  it('lists connections with person, scopes, last call, status, activity and revoke', () => {
    detail();
    const table = screen.getByRole('table', { name: 'Connections to Claude' });
    const person = within(table).getByRole('link', { name: /Jane/ });
    expect(person.getAttribute('href')).toBe('/users/u1');
    expect(within(table).getByText('incident_search')).toBeTruthy();
    expect(within(table).getByText('Active')).toBeTruthy();
    expect(within(table).getByRole('button', { name: /activity/i })).toBeTruthy();
    fireEvent.click(
      within(table).getByRole('button', { name: 'Revoke connection for Claude and Jane' })
    );
    expect(screen.getByRole('alertdialog', { name: 'Revoke connection for Claude?' })).toBeTruthy();
  });

  it('revokes the assistant through the existing action', async () => {
    detail();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke assistant' }));
    await waitFor(() => expect(noop).toHaveBeenCalledTimes(1));
    const form = (noop.mock.calls[0] as unknown as [FormData])[0];
    expect(Object.fromEntries(form)).toEqual({
      kind: 'client',
      id: 'https://claude.ai/oauth/metadata.json',
    });
  });

  it('offers restore instead of revoke for a revoked assistant', () => {
    detail({ client: client({ revokedAt: now }) });
    expect(screen.queryByRole('button', { name: 'Revoke Claude' })).toBeNull();
    expect(screen.getByRole('button', { name: /Allow Claude again|Restore/ })).toBeTruthy();
  });

  it('shows usage for each window and the latest requests', () => {
    detail();
    const table = screen.getByRole('table', { name: 'Usage of Claude' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Last 30 days')).toBeTruthy();
    expect(within(table).getByText('30')).toBeTruthy();
    const recent = screen.getByRole('list', { name: 'Recent requests' });
    expect(recent.textContent).toMatch(/Rate limited/);
    expect(screen.getByText('RATE_LIMITED')).toBeTruthy();
    expect(screen.getByText(/· Jane · 12 ms/)).toBeTruthy();
  });

  it('links to every connection when more exist than the list shows', () => {
    detail({ connectionsTotal: 45 });
    const link = screen.getByRole('link', { name: 'All 45 connections' });
    expect(link.getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=connections&client=https%3A%2F%2Fclaude.ai%2Foauth%2Fmetadata.json&status=all'
    );
  });
});

describe('Assistants list', () => {
  it('links each assistant to its detail page', () => {
    render(
      <McpAssistantsSection
        rows={[client()]}
        counts={{ active: 1, revoked: 0, all: 1 }}
        total={1}
        page={1}
        status="all"
        type="all"
        q=""
        now={now}
        timeZone="UTC"
        scopeChoices={[]}
        defaultScopes={[]}
        describeScope={describeScope}
        revokeAction={noop}
        restoreAction={vi.fn()}
        registerAction={vi.fn()}
      />
    );
    expect(screen.getByRole('link', { name: 'Claude' }).getAttribute('href')).toBe(
      '/settings/integrations/mcp/assistants/https%3A%2F%2Fclaude.ai%2Foauth%2Fmetadata.json'
    );
  });
});

describe('User MCP panel', () => {
  const panel = (rows: McpGrantRow[], active = rows.length, revokeAll = noop) =>
    render(
      <McpUserPanel
        userId="u1"
        name="Jane"
        rows={rows}
        total={rows.length}
        active={active}
        now={now}
        timeZone="UTC"
        describeScope={describeScope}
        revokeAction={noop}
        revokeAllAction={revokeAll}
        activityAction={activity}
      />
    );

  it('lists assistants and personal tokens, linking assistants to their page', () => {
    panel([grant(), grant({ id: 'g2', kind: 'pat', label: 'Laptop script', status: 'expired' })]);
    const table = screen.getByRole('table', { name: "Jane's assistant connections" });
    expect(within(table).getByRole('link', { name: 'Claude' }).getAttribute('href')).toBe(
      '/settings/integrations/mcp/assistants/https%3A%2F%2Fclaude.ai%2Foauth%2Fmetadata.json'
    );
    expect(within(table).getByText('Laptop script')).toBeTruthy();
    expect(within(table).getByText('Personal token')).toBeTruthy();
    expect(within(table).getByText('Expired')).toBeTruthy();
    // Only the live connection can be revoked one by one.
    expect(within(table).getAllByRole('button', { name: /^Revoke connection/ })).toHaveLength(1);
  });

  it('disconnects all of them only after the acknowledgement, sending the person', async () => {
    const revokeAll = vi.fn(async () => {});
    panel([grant()], 1, revokeAll);
    fireEvent.click(screen.getByRole('button', { name: "Disconnect all of Jane's assistants" }));
    const dialog = screen.getByRole('alertdialog', {
      name: "Disconnect all of Jane's assistants?",
    });
    const confirm = within(dialog).getByRole('button', { name: 'Disconnect all' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(confirm);
    await waitFor(() => expect(revokeAll).toHaveBeenCalledTimes(1));
    const form = (revokeAll.mock.calls[0] as unknown as [FormData])[0];
    expect(Object.fromEntries(form)).toEqual({ userId: 'u1', confirm: 'on' });
  });

  it('has nothing to disconnect for someone without connections', () => {
    panel([], 0);
    expect(screen.getByText(/has not connected an assistant/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Disconnect all/ })).toBeNull();
  });
});

describe('Connect an AI assistant entry', () => {
  it('links to the Connect tab with a full-size target', () => {
    render(<McpConnectEntry />);
    expect(screen.getByRole('region', { name: 'Connect an AI assistant' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /Set up a connection/ });
    expect(link.getAttribute('href')).toBe('/settings/integrations/mcp?tab=connect');
    expect(link.className).toMatch(/min-h-11/);
  });
});

describe('Usage chart', () => {
  it('labels buckets in UTC by hour or day', () => {
    expect(usageBucketLabel('2026-11-12T05:00:00.000Z', 'hour')).toBe('Nov 12, 05:00');
    expect(usageBucketLabel('2026-11-12T00:00:00.000Z', 'day')).toBe('Nov 12');
  });

  it('draws a line per series and names the period for screen readers', () => {
    render(
      <McpUsageChart
        bucket="day"
        series={[
          { at: '2026-11-10T00:00:00.000Z', calls: 0, failed: 0 },
          { at: '2026-11-11T00:00:00.000Z', calls: 5, failed: 2 },
        ]}
      />
    );
    const figure = screen.getByRole('figure', { name: 'Calls over time' });
    // An area and a stroke for each of the two series.
    expect(figure.querySelectorAll('path')).toHaveLength(4);
    expect(figure.textContent).toMatch(/5 calls and 2 failed per day, Nov 10 to Nov 11 \(UTC\)/);
  });
});

describe('Grant list', () => {
  it('shows why a live connection is blocked', () => {
    render(
      <McpGrantList
        rows={[grant({ blockedReason: 'user_inactive' })]}
        show="person"
        caption="x"
        now={now}
        timeZone="UTC"
        describeScope={describeScope}
        revokeAction={noop}
        activityAction={activity}
      />
    );
    expect(screen.getByText('User inactive')).toBeTruthy();
  });
});
