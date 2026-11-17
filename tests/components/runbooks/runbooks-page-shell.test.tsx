// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Workflow } from 'lucide-react';

vi.mock('next/navigation', () => ({ usePathname: () => '/runbooks/executions/exec-1' }));

import { RunbooksPageShell } from '@/components/runbooks/RunbooksPageShell';

afterEach(cleanup);

describe('RunbooksPageShell', () => {
  it('frames a runbooks route with the header, breadcrumbs, module nav and sub-nav', () => {
    render(
      <RunbooksPageShell
        navigation={{ activeExecutions: 2, onlineAgents: 3, health: 'HEALTHY' }}
        subNav={<nav aria-label="Section">sub</nav>}
        header={{
          title: 'Restart worker',
          icon: Workflow,
          breadcrumbs: [
            { label: 'Runbooks', href: '/runbooks' },
            { label: 'Executions', href: '/runbooks/executions' },
            { label: 'Restart worker' },
          ],
        }}
      >
        <p>content</p>
      </RunbooksPageShell>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Restart worker' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Executions' })).toHaveAttribute(
      'href',
      '/runbooks/executions'
    );
    const moduleNav = screen.getByRole('navigation', { name: 'Runbook navigation' });
    expect(within(moduleNav).getByRole('link', { name: /Executions/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('navigation', { name: 'Section' })).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
