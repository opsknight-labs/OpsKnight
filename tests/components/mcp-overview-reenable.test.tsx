import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpOverviewSection from '@/components/settings/mcp/sections/McpOverviewSection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

type Props = Parameters<typeof McpOverviewSection>[0];
const base = {
  isAdmin: true,
  enabled: false,
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
} as unknown as Props;

it('promises read-only defaults only on a first run', () => {
  render(<McpOverviewSection {...base} />);
  expect(screen.getByRole('heading', { name: 'Turn on AI assistant access' })).toBeTruthy();
  expect(screen.getByText(/Read-only to start/)).toBeTruthy();
});

it('discloses the write and sensitive access that turning MCP back on restores', () => {
  render(
    <McpOverviewSection
      {...base}
      previous={{ scopes: 48, automatic: true, writesEnabled: true, sensitiveReadsEnabled: true }}
    />
  );
  expect(screen.getByRole('heading', { name: 'Turn AI assistant access back on' })).toBeTruthy();
  expect(screen.queryByText(/Read-only to start/)).toBeNull();
  expect(screen.getByText(/48 permissions for automatic connections/)).toBeTruthy();
  expect(
    screen.getByText(
      /Assistants can make changes again; configuration changes and runbook runs still wait for human review/
    )
  ).toBeTruthy();
  expect(screen.getByText(/Sensitive configuration reads are turned back on/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Review the access policy' }).getAttribute('href')).toBe(
    '?tab=policy'
  );
});

it('says when a restored policy stays read-only with automatic connections off', () => {
  render(
    <McpOverviewSection
      {...base}
      previous={{ scopes: 1, automatic: false, writesEnabled: false, sensitiveReadsEnabled: false }}
    />
  );
  expect(
    screen.getByText(/1 permission for automatic connections \(automatic connections stay off\)/)
  ).toBeTruthy();
  expect(screen.getByText(/Read-only: assistants cannot propose changes/)).toBeTruthy();
  expect(screen.getByText(/Sensitive configuration reads stay off/)).toBeTruthy();
});

it('states the protocol revision this server implements', () => {
  render(<McpOverviewSection {...base} enabled />);
  expect(screen.getByText('MCP 2026-07-28')).toBeTruthy();
  expect(screen.queryByText(/2024-11-05/)).toBeNull();
  expect(screen.queryByText(/Official Anthropic/)).toBeNull();
});
