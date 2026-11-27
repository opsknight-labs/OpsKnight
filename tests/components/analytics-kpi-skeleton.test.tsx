import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { KpiGridSkeleton } from '@/components/analytics/KpiCard';

describe('loading key metrics', () => {
  it('announces loading without exposing decorative cards as orphaned list items', async () => {
    const { container } = render(<KpiGridSkeleton count={4} />);
    expect(screen.getByRole('status', { name: 'Loading key metrics' })).toBeVisible();
    expect(container.querySelectorAll('li')).toHaveLength(4);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    const result = await axe.run(container, {
      runOnly: { type: 'rule', values: ['listitem'] },
    });
    expect(result.violations).toEqual([]);
  });
});
