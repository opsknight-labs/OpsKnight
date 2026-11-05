import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpActivityDrawer from '@/components/settings/mcp/McpActivityDrawer';
import McpConnectionsSection from '@/components/settings/mcp/sections/McpConnectionsSection';
import McpApprovalsSection from '@/components/settings/mcp/sections/McpApprovalsSection';
import McpOverviewSection from '@/components/settings/mcp/sections/McpOverviewSection';
import { MCP_RISK, riskLabel, riskMeta } from '@/components/settings/mcp/risk';
import type { McpApprovalRow, McpGrantRow } from '@/app/(app)/settings/integrations/mcp/queries';
import type { McpConnectionActivity } from '@/app/(app)/settings/integrations/mcp/activity';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const now = new Date('2026-11-05T12:00:00Z');

function grant(overrides: Partial<McpGrantRow> = {}): McpGrantRow {
  return {
    id: 'g1',
    scopes: ['incidents:read'],
    effectiveScopes: ['incidents:read'],
    blockedReason: null,
    status: 'active',
    createdAt: now,
    lastUsedAt: null,
    lastCallAt: null,
    lastTool: null,
    expiresAt: new Date(now.getTime() + 86_400_000),
    revokedAt: null,
    user: { id: 'u1', name: 'Jane', email: 'jane@example.com' },
    client: { id: 'c1', name: 'Claude', type: 'automatic', metadataHost: null, revoked: false },
    ...overrides,
  };
}

function connections(rows: McpGrantRow[], isAdmin: boolean, activityAction?: () => never) {
  return render(
    <McpConnectionsSection
      isAdmin={isAdmin}
      rows={rows}
      counts={{ active: rows.length, expired: 0, revoked: 0, all: rows.length }}
      total={rows.length}
      page={1}
      status="active"
      q=""
      client={null}
      now={now}
      timeZone="UTC"
      describeScope={scope => scope}
      revokeAction={vi.fn()}
      revokeAllAction={vi.fn()}
      activityAction={activityAction}
    />
  );
}

describe('UX-14 the blocked reason is visible, not a tooltip', () => {
  it('shows a distinct label and the hint inline, with a policy link only for admins', () => {
    connections([grant({ blockedReason: 'client_untrusted' })], true);
    expect(screen.getByText('Assistant not trusted')).toBeTruthy();
    const hint = screen.getByText(/no longer trusts this assistant/);
    expect(hint.closest('[title]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open access policy' }).getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=policy'
    );
    cleanup();
    connections([grant({ blockedReason: 'client_untrusted' })], false);
    expect(screen.getByText(/no longer trusts this assistant/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open access policy' })).toBeNull();
    cleanup();
    connections([grant({ blockedReason: 'access_changed' })], true);
    expect(screen.getByText('Signed out by security change')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open access policy' })).toBeNull();
  });
});

describe('D8 activity drawer', () => {
  const page = (ids: string[], next: McpConnectionActivity['next']): McpConnectionActivity => ({
    calls: ids.map(id => ({
      id,
      at: '2026-11-05T11:00:00.000Z',
      tool: 'read_operation',
      operationId: 'listServices',
      outcome: id === 'b' ? 'tool_error' : 'served',
      durationMs: 12,
      requestId: '0123456789abcdef',
      errorCode: null,
    })),
    next,
    changes: [
      {
        id: 'ch1',
        at: '2026-11-05T10:00:00.000Z',
        action: 'incident.acknowledged',
        entityType: 'INCIDENT',
        entityId: 'i1',
      },
    ],
    historyHref: '/settings/api-keys?tab=activity&key=mcp%3Ag1',
  });

  it('loads on open, labels outcomes in plain words and pages older requests', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], { at: '2026-11-05T11:00:00.000Z', id: 'b' }))
      .mockResolvedValueOnce(page(['c'], null));
    render(<McpActivityDrawer grantId="g1" label="Claude for Jane" timeZone="UTC" load={load} />);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Activity for Claude for Jane' }));
    await screen.findByText('Tool error');
    expect(load).toHaveBeenCalledWith({ grantId: 'g1' });
    expect(screen.getAllByText('Answered')).toHaveLength(1);
    expect(screen.getAllByText('read_operation · listServices')).toHaveLength(2);
    expect(screen.getByText('incident.acknowledged')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Full change history in API activity' }).getAttribute('href')
    ).toBe('/settings/api-keys?tab=activity&key=mcp%3Ag1');
    fireEvent.click(screen.getByRole('button', { name: 'Show older requests' }));
    await waitFor(() => expect(screen.getAllByText('Answered')).toHaveLength(2));
    expect(load).toHaveBeenLastCalledWith({
      grantId: 'g1',
      cursor: { at: '2026-11-05T11:00:00.000Z', id: 'b' },
    });
    expect(screen.queryByRole('button', { name: 'Show older requests' })).toBeNull();
  });

  it('is offered on each connection row when the page passes a loader', () => {
    connections([grant()], true, vi.fn() as never);
    expect(screen.getByRole('button', { name: 'Activity for Claude for Jane' })).toBeTruthy();
  });
});

function approval(overrides: Partial<McpApprovalRow> = {}): McpApprovalRow {
  return {
    id: 'a1',
    kind: 'operations',
    title: 'updateService',
    detail: 'PATCH /services/{id}',
    risk: 'R2',
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
    decidedAt: null,
    requester: { id: 'u1', name: 'Jane', email: null },
    reviewer: null,
    selfApproved: false,
    decisionReason: null,
    assistant: null,
    assistantHost: null,
    href: '/settings/integrations/mcp/approvals/operations/a1',
    ...overrides,
  };
}

const approvals = (
  props: Partial<Parameters<typeof McpApprovalsSection>[0]> & { rows: McpApprovalRow[] }
) =>
  render(
    <McpApprovalsSection
      total={props.rows.length}
      page={1}
      kind="operations"
      state="pending"
      pending={{ operations: props.rows.length, runbooks: 0 }}
      writesEnabled
      now={now}
      timeZone="UTC"
      {...props}
    />
  );

describe('UX-8 one risk vocabulary', () => {
  it('uses the capability panel colours and a label in the queue', () => {
    approvals({ rows: [approval()] });
    const pill = screen.getByText('R2 · Sensitive');
    expect(pill.getAttribute('title')).toBe('Sensitive change');
    for (const token of MCP_RISK.R2.className.split(' ')) expect(pill.className).toContain(token);
  });

  it('falls back to a neutral pill for codes outside R0-R3', () => {
    expect(riskMeta('NON_IDEMPOTENT').title).toBe('NON_IDEMPOTENT');
    expect(riskMeta('NON_IDEMPOTENT').className).not.toMatch(/rose|amber|orange|blue/);
    expect(riskMeta('constructor').title).toBe('constructor');
    expect(riskLabel('R3')).toBe('R3 · Destructive or high-impact change');
  });
});

describe('UX-2 the empty queue points at the other one', () => {
  it('links to waiting runbook runs from an empty change queue, with the kind explicit', () => {
    approvals({ rows: [], pending: { operations: 0, runbooks: 3 } });
    const link = screen.getByRole('link', { name: /3 runbook runs are waiting/ });
    expect(link.getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=approvals&kind=runbooks'
    );
    // The change chip keeps its kind, so it never bounces back to the runbook queue.
    const chips = screen.getByRole('navigation', { name: 'Approval type' });
    expect(
      within(chips)
        .getAllByRole('link')
        .map(chip => chip.getAttribute('href'))
    ).toContain('/settings/integrations/mcp?tab=approvals&kind=operations');
  });
});

describe('UX-10 overview says each fact once, in plain words', () => {
  it('drops the duplicate fact strip and the DCR jargon', () => {
    render(
      <McpOverviewSection
        isAdmin
        enabled
        ready
        automaticReady
        endpoint="https://ops.example.com/mcp"
        originSource="App URL"
        sessionIdleDays={30}
        writesEnabled
        counts={{ activeConnections: 1, activeClients: 1, pendingApprovals: 0 }}
        hrefs={{
          connect: '?tab=connect',
          connections: '?tab=connections',
          assistants: '?tab=assistants',
          approvals: '?tab=approvals',
          policy: '?tab=policy',
        }}
        enableAction={vi.fn(async () => {})}
        testAction={vi.fn()}
      />
    );
    const text = document.body.textContent ?? '';
    for (const jargon of ['DCR', 'CIMD', 'PKCE', 'Approval Gate', 'Protocol Spec', 'Mutations'])
      expect(text).not.toContain(jargon);
    expect(screen.getByText('Automatic connections on')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Access policy' })).toBeTruthy();
    expect(screen.getByText('Protocol')).toBeTruthy();
    expect(screen.getByText('Direct + reviewed')).toBeTruthy();
  });
});
