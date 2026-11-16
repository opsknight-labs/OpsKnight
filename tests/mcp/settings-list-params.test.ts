import { describe, expect, it } from 'vitest';
import {
  effectiveApprovalKind,
  mcpHref,
  parseMcpListParams,
  totalPages,
  waitingApprovalKind,
} from '@/app/(app)/settings/integrations/mcp/list-params';
import { pageWindow } from '@/components/settings/mcp/McpListKit';

describe('MCP settings URL state', () => {
  it('defaults to the overview with active connections and pending approvals', () => {
    expect(parseMcpListParams({}, true)).toEqual({
      section: 'overview',
      page: 1,
      q: '',
      grantStatus: 'active',
      clientStatus: 'all',
      clientType: 'all',
      clientId: null,
      approvalKind: 'operations',
      approvalKindExplicit: false,
      approvalState: 'pending',
      usageWindow: '24h',
      usageBy: 'tool',
      usageFrom: null,
      usageTo: null,
    });
  });

  it('keeps usage dates only in calendar-date shape', () => {
    const params = parseMcpListParams({ from: '2026-11-01', to: '2026-11-03T00:00' }, true);
    expect(params.usageFrom).toBe('2026-11-01');
    expect(params.usageTo).toBeNull();
  });

  it('keeps administrator sections away from everyone else', () => {
    for (const tab of ['assistants', 'approvals', 'policy', 'capabilities', 'usage'])
      expect(parseMcpListParams({ tab }, false).section).toBe('overview');
    expect(parseMcpListParams({ tab: 'connections' }, false).section).toBe('connections');
    expect(parseMcpListParams({ tab: 'policy' }, true).section).toBe('policy');
    expect(parseMcpListParams({ tab: 'usage' }, true).section).toBe('usage');
    // The Usage view falls back to safe defaults on anything unknown.
    expect(parseMcpListParams({ tab: 'usage', window: '7d', by: 'user' }, true)).toMatchObject({
      usageWindow: '7d',
      usageBy: 'user',
    });
    expect(parseMcpListParams({ tab: 'usage', window: '90y', by: 'sql' }, true)).toMatchObject({
      usageWindow: '24h',
      usageBy: 'tool',
    });
    // Only administrators can narrow connections to one assistant.
    expect(parseMcpListParams({ client: 'cm1' }, false).clientId).toBeNull();
    expect(parseMcpListParams({ client: 'cm1' }, true).clientId).toBe('cm1');
  });

  it('falls back safely on invalid or hostile input', () => {
    const parsed = parseMcpListParams(
      {
        tab: 'nope',
        page: ['-4', '9'],
        status: 'deleted',
        type: 'x',
        kind: 'y',
        state: 'z',
        q: `  ${'a'.repeat(300)}  `,
        client: 'has space',
      },
      true
    );
    expect(parsed).toMatchObject({
      section: 'overview',
      page: 1,
      grantStatus: 'active',
      clientType: 'all',
      approvalKind: 'operations',
      approvalState: 'pending',
      clientId: null,
    });
    expect(parsed.q).toHaveLength(100);
    expect(parseMcpListParams({ page: '999999999' }, true).page).toBe(10_000);
    expect(parseMcpListParams({ page: '3' }, true).page).toBe(3);
  });

  it('builds short links that drop defaults', () => {
    expect(mcpHref({ tab: 'overview', page: 1 })).toBe('/settings/integrations/mcp');
    expect(mcpHref({ tab: 'connections', status: null, q: 'jane doe', page: 2 })).toBe(
      '/settings/integrations/mcp?tab=connections&q=jane+doe&page=2'
    );
  });

  it('pages with a window around the current page', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(41)).toBe(3);
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageWindow(12, 12)).toEqual([1, null, 11, 12]);
  });

  it('UX-2 opens the runbook queue when only runbook runs are waiting', () => {
    const onlyRunbooks = { operations: 0, runbooks: 3 };
    expect(waitingApprovalKind(onlyRunbooks)).toBe('runbooks');
    expect(waitingApprovalKind({ operations: 1, runbooks: 3 })).toBeNull();
    expect(waitingApprovalKind({ operations: 0, runbooks: 0 })).toBeNull();
    expect(waitingApprovalKind(null)).toBeNull();
    expect(mcpHref({ tab: 'approvals', kind: waitingApprovalKind(onlyRunbooks) })).toBe(
      '/settings/integrations/mcp?tab=approvals&kind=runbooks'
    );
    // A bare ?tab=approvals follows the waiting queue; an explicit kind is always respected.
    const bare = parseMcpListParams({ tab: 'approvals' }, true);
    expect(bare.approvalKindExplicit).toBe(false);
    expect(effectiveApprovalKind(bare, onlyRunbooks)).toBe('runbooks');
    expect(effectiveApprovalKind(bare, { operations: 2, runbooks: 3 })).toBe('operations');
    const chosen = parseMcpListParams({ tab: 'approvals', kind: 'operations' }, true);
    expect(chosen.approvalKindExplicit).toBe(true);
    expect(effectiveApprovalKind(chosen, onlyRunbooks)).toBe('operations');
  });
});
