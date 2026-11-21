import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/m/intelligence',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/(app)/intelligence/insight-actions', () => ({ decideInsightAction: vi.fn() }));

import NeedsAttention from '@/components/intelligence/overview/NeedsAttention';

const insight = {
  id: 'i1',
  scopeType: 'SERVICE',
  scopeId: 'svc-1',
  kind: 'k',
  key: 'k',
  area: 'service',
  severity: 'WARNING',
  status: 'OPEN',
  title: 'No escalation policy',
  summary: 'Pages go nowhere.',
  evidence: { facts: [] },
  draftHref: '/services/svc-1/settings',
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
  scopeName: 'Payments',
  scopeHref: '/services/svc-1',
} as never;

describe('Needs attention on mobile', () => {
  it('renders nothing when there is nothing to act on', () => {
    const { container } = render(<NeedsAttention items={[]} insights={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('points insight scope and draft links at the resolved (mobile) routes', () => {
    render(<NeedsAttention items={[]} insights={[insight]} resolveHref={href => `/m${href}`} />);
    expect(screen.getByRole('link', { name: /Payments/ })).toHaveAttribute(
      'href',
      '/m/services/svc-1'
    );
    const hrefs = screen.getAllByRole('link').map(link => link.getAttribute('href'));
    expect(hrefs).toContain('/m/services/svc-1/settings');
  });
});
