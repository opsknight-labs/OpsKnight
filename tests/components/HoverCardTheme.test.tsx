import React from 'react';
import Link from 'next/link';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/shadcn/hover-card';

afterEach(cleanup);

describe('hover card theme boundary', () => {
  it.each(['light', 'dark'])('escapes inverse chrome in the %s page theme', theme => {
    document.documentElement.className = theme;
    const { container } = render(
      <header className="ok-inverse-surface" style={{ transform: 'translateZ(0)' }}>
        <HoverCard open>
          <HoverCardTrigger asChild>
            <button>Operational status</button>
          </HoverCardTrigger>
          <HoverCardContent aria-label="Incident summary">
            <span>Critical incidents detected</span>
            <Link href="/incidents">View incidents</Link>
          </HoverCardContent>
        </HoverCard>
      </header>
    );

    const content = screen.getByLabelText('Incident summary');
    expect(container.querySelector('header')).toContainElement(screen.getByRole('button'));
    expect(content.closest('.ok-inverse-surface')).toBeNull();
    expect(document.body).toContainElement(content);
    expect(content).toContainElement(screen.getByRole('link', { name: 'View incidents' }));
    expect(content).toHaveClass('bg-popover', 'text-popover-foreground');
    document.documentElement.className = '';
  });
});
