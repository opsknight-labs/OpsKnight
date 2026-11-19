import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const countInsightsInboxBadge = vi.fn();
vi.mock('@/lib/intelligence/ops-insights/view', () => ({
  countInsightsInboxBadge: (...args: unknown[]) => countInsightsInboxBadge(...args),
}));

import AttentionBadge from '@/components/intelligence/overview/AttentionBadge';

const actor = (role: string) => ({ id: 'u1', role, status: 'ACTIVE' }) as AuthorizationActor;

beforeEach(() => countInsightsInboxBadge.mockReset());

describe('AttentionBadge', () => {
  it('links to the inbox with the count', async () => {
    countInsightsInboxBadge.mockResolvedValue({ count: 3, more: false });
    render(await AttentionBadge({ actor: actor('RESPONDER') }));
    const link = screen.getByRole('link', { name: '3 insights need attention' });
    expect(link).toHaveAttribute('href', '/intelligence');
    expect(link).toHaveTextContent('3');
  });

  it('caps the count when the read stopped at its limit', async () => {
    countInsightsInboxBadge.mockResolvedValue({ count: 9, more: true });
    render(await AttentionBadge({ actor: actor('ADMIN') }));
    expect(
      screen.getByRole('link', { name: 'More than 9 insights need attention' })
    ).toHaveTextContent('9+');
  });

  it('renders nothing when empty, failing, or for a role that cannot read Intelligence', async () => {
    countInsightsInboxBadge.mockResolvedValue({ count: 0, more: false });
    expect(await AttentionBadge({ actor: actor('ADMIN') })).toBeNull();
    countInsightsInboxBadge.mockRejectedValue(new Error('db down'));
    expect(await AttentionBadge({ actor: actor('ADMIN') })).toBeNull();
    countInsightsInboxBadge.mockResolvedValue({ count: 2, more: false });
    expect(await AttentionBadge({ actor: actor('USER') })).toBeNull();
    expect(countInsightsInboxBadge).toHaveBeenCalledTimes(2);
  });
});
