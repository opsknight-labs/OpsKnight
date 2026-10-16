// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/runbooks/agents' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

import { FleetSubNav } from '@/components/runbooks/agents/FleetSubNav';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { HealthAttentionPanel } from '@/components/runbooks/health/HealthAttentionPanel';

afterEach(cleanup);
beforeEach(() => {
  navigation.pathname = '/runbooks/agents';
});

describe('FleetSubNav', () => {
  it('links every section and marks the current one with aria-current', () => {
    navigation.pathname = '/runbooks/agents/pools';
    render(<FleetSubNav canManageSecrets />);
    const nav = screen.getByRole('navigation', { name: 'Infrastructure sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(['Agents', 'Pools', 'Secrets', 'Security']);
    expect(within(nav).getByRole('link', { name: 'Pools' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(nav).getByRole('link', { name: 'Pools' })).toHaveAttribute(
      'href',
      '/runbooks/agents/pools'
    );
    expect(within(nav).getByRole('link', { name: 'Agents' })).not.toHaveAttribute('aria-current');
  });

  it('hides Secrets without secret management permission', () => {
    render(<FleetSubNav canManageSecrets={false} />);
    const nav = screen.getByRole('navigation', { name: 'Infrastructure sections' });
    expect(within(nav).queryByRole('link', { name: 'Secrets' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('RunbookModuleNav', () => {
  it.each([
    ['/runbooks/agents/secrets', 'Agents'],
    ['/runbooks/agents/cagent/setup', 'Agents'],
    ['/runbooks/health', 'Health'],
    ['/runbooks/executions/cexec', 'Executions'],
    ['/runbooks', 'Library'],
    ['/runbooks/crunbook', 'Library'],
  ])('highlights the owning section for %s', (pathname, label) => {
    navigation.pathname = pathname;
    render(<RunbookModuleNav />);
    const nav = screen.getByRole('navigation', { name: 'Runbook navigation' });
    const current = within(nav)
      .getAllByRole('link')
      .filter(link => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });
});

describe('HealthAttentionPanel', () => {
  it('lists danger issues before warnings, each linking to its fix location', () => {
    render(
      <HealthAttentionPanel
        agentsCount={3}
        health="DEGRADED"
        issues={[
          {
            id: 'degraded',
            type: 'agent',
            severity: 'warning',
            title: '1 Agent Degraded',
            description: 'Faults',
            actionHref: '/runbooks/agents?status=DEGRADED',
            actionLabel: 'Review degraded Agents',
          },
          {
            id: 'offline',
            type: 'agent',
            severity: 'danger',
            title: '2 Agents Offline',
            description: 'No heartbeat',
            actionHref: '/runbooks/agents?status=OFFLINE',
            actionLabel: 'Review offline Agents',
          },
        ]}
      />
    );
    const headings = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent);
    expect(headings).toEqual(['2 Agents Offline', '1 Agent Degraded']);
    expect(screen.getByRole('link', { name: /Review offline Agents/ })).toHaveAttribute(
      'href',
      '/runbooks/agents?status=OFFLINE'
    );
  });
});
