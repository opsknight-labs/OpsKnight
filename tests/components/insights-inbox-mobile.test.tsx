import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/m/intelligence',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/(app)/intelligence/insight-actions', () => ({ decideInsightAction: vi.fn() }));
vi.mock('@/lib/intelligence/ai/settings', () => ({
  getAiPublicStatus: vi.fn(async () => ({ squireEnabled: false })),
}));
const listInsightsInbox = vi.fn();
vi.mock('@/lib/intelligence/ops-insights/view', () => ({
  listInsightsInbox: (...args: unknown[]) => listInsightsInbox(...args),
}));

import InsightsInboxSection from '@/components/intelligence/insights/InsightsInboxSection';

const actor = { id: 'u1', role: 'USER' } as never;
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
};

describe('InsightsInboxSection on mobile', () => {
  it('renders nothing when the inbox is empty', async () => {
    listInsightsInbox.mockResolvedValueOnce({ items: [], nextCursor: null });
    expect(await InsightsInboxSection({ actor })).toBeNull();
  });

  it('points the insight links at the resolved (mobile) routes', async () => {
    listInsightsInbox.mockResolvedValueOnce({ items: [insight], nextCursor: null });
    render(
      (await InsightsInboxSection({
        actor,
        resolveHref: href => `/m${href}`,
      })) as React.ReactElement
    );
    expect(screen.getByRole('link', { name: /Payments/ })).toHaveAttribute(
      'href',
      '/m/services/svc-1'
    );
  });
});
