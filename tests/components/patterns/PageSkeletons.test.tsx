import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DashboardPageSkeleton,
  DetailPageSkeleton,
  ListPageSkeleton,
  LogPageSkeleton,
  SettingsPageSkeleton,
} from '@/components/patterns';

describe('page skeleton presets', () => {
  it.each([
    ['list', <ListPageSkeleton key="l" label="Loading things" />],
    ['detail', <DetailPageSkeleton key="d" label="Loading things" />],
    ['settings', <SettingsPageSkeleton key="s" label="Loading things" tabs statsCount={3} />],
    ['settings table', <SettingsPageSkeleton key="st" label="Loading things" variant="table" />],
    ['dashboard', <DashboardPageSkeleton key="b" label="Loading things" />],
    ['log', <LogPageSkeleton key="g" label="Loading things" />],
  ])('%s renders exactly one busy status region with one label', (_name, ui) => {
    const { container } = render(ui);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    expect(screen.getByText('Loading things')).toHaveClass('sr-only');
  });

  it('list preset renders the requested number of directory rows', () => {
    const { container } = render(<ListPageSkeleton label="x" rows={3} columns={2} />);
    // phone rows (3) + table body rows (3)
    expect(container.querySelectorAll('.divide-y > div')).toHaveLength(6);
  });
});
