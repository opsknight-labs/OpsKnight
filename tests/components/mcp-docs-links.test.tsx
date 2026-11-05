import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpConnectGuide from '@/components/settings/mcp/McpConnectGuide';
import McpOverviewSection from '@/components/settings/mcp/sections/McpOverviewSection';
import McpConsentResult from '@/app/oauth/mcp/consent/result/page';
import { mcpErrorPage } from '@/lib/mcp/auth/friendly-error';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { MCP_DOCS_LINKS } from '@/lib/mcp/docs-links';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const docsHrefs = () =>
  within(screen.getByRole('navigation', { name: 'MCP documentation' }))
    .getAllByRole('link')
    .map(link => link.getAttribute('href'));

describe('F4: in-app links to the MCP documentation', () => {
  it('the Connect guide links to setup, troubleshooting and permissions', () => {
    render(<McpConnectGuide endpoint="https://ops.example.com/mcp" />);
    expect(docsHrefs()).toEqual([
      MCP_DOCS_LINKS.guide,
      MCP_DOCS_LINKS.troubleshooting,
      MCP_DOCS_LINKS.permissions,
    ]);
  });

  it('the Overview setup check links to the documentation', () => {
    type Props = Parameters<typeof McpOverviewSection>[0];
    render(
      <McpOverviewSection
        {...({
          isAdmin: true,
          enabled: true,
          ready: true,
          automaticReady: true,
          endpoint: 'https://ops.example.com/mcp',
          originSource: null,
          sessionIdleDays: 30,
          writesEnabled: false,
          counts: { activeConnections: 0, activeClients: 0, pendingApprovals: 0 },
          hrefs: {
            connect: '?tab=connect',
            connections: '?tab=connections',
            assistants: '?tab=assistants',
            approvals: '?tab=approvals',
            policy: '?tab=policy',
          },
          enableAction: vi.fn(async () => {}),
          testAction: vi.fn(),
        } as unknown as Props)}
      />
    );
    expect(docsHrefs()).toContain(MCP_DOCS_LINKS.troubleshooting);
  });

  it('the consent result page links to troubleshooting and echoes only known codes', async () => {
    render(
      await McpConsentResult({ searchParams: Promise.resolve({ code: 'MCP_ACCESS_CHANGED' }) })
    );
    expect(screen.getByRole('link', { name: 'Troubleshooting guide' }).getAttribute('href')).toBe(
      MCP_DOCS_LINKS.troubleshooting
    );
    expect(screen.getByText(/Reference: MCP_ACCESS_CHANGED/)).toBeTruthy();
    cleanup();
    render(await McpConsentResult({ searchParams: Promise.resolve({ code: 'Call_this_number' }) }));
    expect(screen.queryByText(/Reference:/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Troubleshooting guide' })).toBeTruthy();
  });

  it('the OAuth error page links to its own row of the troubleshooting page (DX-2)', async () => {
    const html = await mcpErrorPage(new McpBoundaryError('invalid_client', 400)).text();
    expect(html).toContain('Reference: invalid_client');
    expect(html).toContain(`href="${MCP_DOCS_LINKS.troubleshooting}#invalid_client"`);
  });
});
