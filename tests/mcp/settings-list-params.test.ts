import { describe, expect, it } from 'vitest';
import {
  mcpHref,
  parseMcpListParams,
  totalPages,
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
      approvalState: 'pending',
    });
  });

  it('keeps administrator sections away from everyone else', () => {
    for (const tab of ['assistants', 'approvals', 'policy', 'capabilities'])
      expect(parseMcpListParams({ tab }, false).section).toBe('overview');
    expect(parseMcpListParams({ tab: 'connections' }, false).section).toBe('connections');
    expect(parseMcpListParams({ tab: 'policy' }, true).section).toBe('policy');
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
});
