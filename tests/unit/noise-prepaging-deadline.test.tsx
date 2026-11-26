import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { summarizeLookupHealth } from '@/lib/intelligence/noise-controls/health';
import LookupDeadlineNotice from '@/components/settings/noise-controls/LookupDeadlineNotice';

vi.mock('server-only', () => ({}));
const { prePagingDeadlineMs, setPrePagingDeadlineMs } =
  await import('@/lib/intelligence/noise-controls/lookup-client');

const rows = (ok: number, failOpen: number) => [
  { labels: { route: 'pool', outcome: 'ok' }, value: ok },
  { labels: { route: 'pool', outcome: 'fail_open' }, value: failOpen },
];

afterEach(() => {
  delete process.env.PREPAGING_DEADLINE_MS;
  setPrePagingDeadlineMs(null);
});

describe('PREPAGING_DEADLINE_MS', () => {
  it('keeps 5 ms by default and honours a valid override, clamped to 1-50', () => {
    expect(prePagingDeadlineMs()).toBe(5);
    process.env.PREPAGING_DEADLINE_MS = '25';
    expect(prePagingDeadlineMs()).toBe(25);
    process.env.PREPAGING_DEADLINE_MS = '500';
    expect(prePagingDeadlineMs()).toBe(50);
    process.env.PREPAGING_DEADLINE_MS = '0';
    expect(prePagingDeadlineMs()).toBe(1);
  });

  it('ignores a value that is not a whole number and lets the test hook win', () => {
    process.env.PREPAGING_DEADLINE_MS = 'fast';
    expect(prePagingDeadlineMs()).toBe(5);
    process.env.PREPAGING_DEADLINE_MS = '25';
    setPrePagingDeadlineMs(10);
    expect(prePagingDeadlineMs()).toBe(10);
  });
});

describe('lookup deadline health', () => {
  it('warns when most lookups were abandoned, as on staging (26 of 27)', () => {
    const health = summarizeLookupHealth(rows(1, 26), 5);
    expect(health).toMatchObject({ lookups: 27, failedOpen: 26, warn: true });
    render(<LookupDeadlineNotice health={health} />);
    expect(screen.getByRole('status').textContent).toMatch(/did not run for 96% of recent alerts/);
    expect(screen.getByRole('status').textContent).toMatch(/PREPAGING_DEADLINE_MS/);
  });

  it('stays quiet with too few lookups, or when only a few were abandoned', () => {
    expect(summarizeLookupHealth(rows(1, 9), 5).warn).toBe(false);
    expect(summarizeLookupHealth(rows(29, 1), 5).warn).toBe(false);
    expect(summarizeLookupHealth([], 5)).toMatchObject({ lookups: 0, warn: false });
    const { container } = render(<LookupDeadlineNotice health={summarizeLookupHealth([], 5)} />);
    expect(container).toBeEmptyDOMElement();
  });
});
