import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/settings/intelligence' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import IntelligenceSubNav, {
  INTELLIGENCE_SECTIONS,
  activeGroupFor,
} from '@/components/settings/layout/IntelligenceSubNav';
import {
  IntelligenceGroupHeader,
  SectionAnchor,
} from '@/components/settings/layout/IntelligenceGroupHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { LEGACY_INTELLIGENCE_ROUTES } from '@/lib/intelligence/settings/routes';

beforeEach(() => {
  nav.pathname = '/settings/intelligence';
});

describe('IntelligenceSubNav', () => {
  it('links the five groups in order, each a 44 px target', () => {
    render(<IntelligenceSubNav />);
    const links = within(
      screen.getByRole('navigation', { name: 'Intelligence sections' })
    ).getAllByRole('link');
    expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Engine', '/settings/intelligence'],
      ['Noise controls', '/settings/intelligence/noise-controls'],
      ['Services & changes', '/settings/intelligence/services'],
      ['Assistant', '/settings/intelligence/ai'],
      ['Evaluation & spend', '/settings/intelligence/evaluation'],
    ]);
    for (const link of links) expect(link.className).toMatch(/\bmin-h-11\b/);
  });

  it('marks exactly one group current on every group page', () => {
    for (const section of INTELLIGENCE_SECTIONS) {
      nav.pathname = section.href;
      const { unmount } = render(<IntelligenceSubNav />);
      const current = screen
        .getAllByRole('link')
        .filter(link => link.getAttribute('aria-current') === 'page');
      expect(current.map(link => link.getAttribute('href'))).toEqual([section.href]);
      unmount();
    }
  });

  it('keeps a nested page under its group and an earlier route under its new home', () => {
    expect(activeGroupFor('/settings/intelligence/services/svc-1/squire')).toBe('services');
    expect(activeGroupFor('/settings/intelligence/response')).toBe('services');
    expect(activeGroupFor('/settings/intelligence/quality')).toBe('evaluation');
    expect(activeGroupFor('/settings/intelligence/insights')).toBe('evaluation');
    expect(activeGroupFor('/settings/intelligence/connections')).toBe('assistant');
    expect(activeGroupFor('/settings/intelligence/ai/memory')).toBe('assistant');
    expect(activeGroupFor('/settings/profile')).toBeNull();
    for (const route of LEGACY_INTELLIGENCE_ROUTES) {
      expect(activeGroupFor(route.from)).toBe(route.group);
    }
  });
});

describe('IntelligenceGroupHeader', () => {
  it('titles the page and links each section of the group by its anchor', () => {
    render(<IntelligenceGroupHeader group="noise">Lead paragraph.</IntelligenceGroupHeader>);
    expect(screen.getByRole('heading', { level: 1, name: 'Noise controls' })).toBeInTheDocument();
    expect(screen.getByText('Lead paragraph.')).toBeInTheDocument();
    const links = within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole(
      'link'
    );
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '#policy',
      '#suppression-rules',
      '#maintenance-windows',
      '#policy-history',
      '#heartbeats',
      '#simulation',
      '#decisions',
    ]);
    for (const link of links) expect(link.className).toMatch(/\bmin-h-11\b/);
  });

  it('omits links to sections the page did not render, and the list when one remains', () => {
    const { rerender } = render(
      <IntelligenceGroupHeader group="engine" title="Intelligence" visible={['general', 'triage']}>
        Lead.
      </IntelligenceGroupHeader>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Intelligence' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '#general',
      '#triage',
    ]);
    expect(screen.queryByRole('link', { name: 'Failed work' })).not.toBeInTheDocument();

    rerender(
      <IntelligenceGroupHeader group="engine" visible={['general']}>
        Lead.
      </IntelligenceGroupHeader>
    );
    expect(screen.queryByRole('navigation', { name: 'On this page' })).not.toBeInTheDocument();
  });

  it('anchors sections below the sticky header', () => {
    const { container } = render(
      <>
        <SectionAnchor id="insights">
          <p>content</p>
        </SectionAnchor>
        <SettingsSection id="alert-quality" title="Alert quality">
          <p>rows</p>
        </SettingsSection>
        <SettingsSection title="No anchor">
          <p>rows</p>
        </SettingsSection>
      </>
    );
    expect(container.querySelector('#insights')?.className).toMatch(/scroll-mt-24/);
    expect(container.querySelector('#alert-quality')?.className).toMatch(/scroll-mt-24/);
    // Only the named sections are anchors; generated heading ids (useId) are not.
    const anchors = Array.from(container.querySelectorAll('[id]'))
      .map(el => el.id)
      .filter(id => /^[a-z][a-z-]*$/.test(id));
    expect(anchors).toEqual(['insights', 'alert-quality']);
  });
});
