import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/settings/intelligence' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import IntelligenceSubNav, { INTELLIGENCE_SECTIONS, isSectionActive } from '@/components/settings/layout/IntelligenceSubNav';
import SquireAvatar from '@/components/squire/SquireAvatar';
import AskSquirePanel from '@/components/squire/AskSquirePanel';
import AiUsageChart from '@/components/settings/AiUsageChart';

describe('IntelligenceSubNav', () => {
  it('marks exactly one section current, with Overview matching only itself', () => {
    expect(isSectionActive('/settings/intelligence', '/settings/intelligence')).toBe(true);
    expect(isSectionActive('/settings/intelligence/ai', '/settings/intelligence')).toBe(false);
    expect(isSectionActive('/settings/intelligence/ai', '/settings/intelligence/ai')).toBe(true);
    expect(isSectionActive('/settings/intelligence/aix', '/settings/intelligence/ai')).toBe(false);

    for (const section of INTELLIGENCE_SECTIONS) {
      nav.pathname = section.href;
      const { unmount } = render(<IntelligenceSubNav />);
      const current = screen.getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page');
      expect(current.map(link => link.getAttribute('href'))).toEqual([section.href]);
      unmount();
    }
  });

  it('is a labelled navigation landmark linking every section', () => {
    render(<IntelligenceSubNav />);
    expect(screen.getByRole('navigation', { name: 'Intelligence sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(INTELLIGENCE_SECTIONS.length);
  });
});

describe('SquireAvatar', () => {
  it.each(['KNIGHT', 'OWL', 'ROBOT'] as const)('renders %s as decorative inline SVG with no network request', kind => {
    const { container } = render(<SquireAvatar kind={kind} />);
    const wrapper = container.querySelector(`[data-avatar="${kind}"]`)!;
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img, image, [href]')).toBeNull();
  });

  it('only animates when asked, and only behind motion-safe', () => {
    const still = render(<SquireAvatar kind="OWL" />);
    expect(still.container.innerHTML).not.toMatch(/animate-/);
    still.unmount();
    const moving = render(<SquireAvatar kind="OWL" animated />);
    expect(moving.container.innerHTML).toMatch(/motion-safe:animate-/);
    expect(moving.container.innerHTML).not.toMatch(/(^|\s)animate-\[/);
  });
});

describe('AskSquirePanel', () => {
  it('opens the assistant with the chosen question', () => {
    const opened = vi.fn();
    window.addEventListener('squire:open', opened);
    render(<AskSquirePanel name="Pip" avatar="KNIGHT" />);
    expect(screen.getByRole('heading', { name: 'Ask Pip' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'What could have caused this?' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ message: 'What could have caused this?' });
    window.removeEventListener('squire:open', opened);
  });
});

describe('AiUsageChart', () => {
  const history = [
    { day: '2026-01-01', requests: 2, tokens: 100 },
    { day: '2026-01-02', requests: 0, tokens: 0 },
    { day: '2026-01-03', requests: 9, tokens: 5_000 },
  ];

  it('offers the exact numbers as an accessible table', () => {
    render(<AiUsageChart history={history} budget={1_000} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[3]).toHaveTextContent('2026-01-03');
    expect(rows[3]).toHaveTextContent('5,000');
  });

  it('highlights days at or over budget and draws nothing for empty days', () => {
    const { container } = render(<AiUsageChart history={history} budget={1_000} />);
    const bars = container.querySelectorAll('[aria-hidden="true"] > div > div');
    expect(bars).toHaveLength(3);
    expect(bars[2].className).toMatch(/bg-destructive/);
    expect(bars[0].className).not.toMatch(/bg-destructive/);
    expect((bars[1] as HTMLElement).style.height).toBe('0%');
  });
});

beforeEach(() => {
  nav.pathname = '/settings/intelligence';
});
