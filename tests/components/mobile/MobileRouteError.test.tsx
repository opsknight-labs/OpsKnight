import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileRouteError } from '@/components/mobile/MobileRouteError';

const refresh = vi.fn();
let mockPathname = '/m/services/svc-1';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ refresh }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

describe('MobileRouteError', () => {
  it('sends a failed detail route back to its list and retries the segment', () => {
    mockPathname = '/m/services/svc-1';
    const reset = vi.fn();
    render(
      <MobileRouteError
        error={new Error('boom')}
        reset={reset}
        title="Service data could not load"
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Service data could not load');
    expect(screen.getByRole('link', { name: /Back to list/i })).toHaveAttribute(
      'href',
      '/m/services'
    );

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(reset).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('sends a failed list route back home', () => {
    mockPathname = '/m/teams';
    render(<MobileRouteError error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Back to home/i })).toHaveAttribute('href', '/m');
  });
});
