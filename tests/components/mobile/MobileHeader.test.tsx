import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MobileHeader from '@/components/mobile/MobileHeader';

let mockPathname = '/m/incidents';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn() }),
}));

// Regression guard for the header-action geometry bug: search previously
// rendered as its own larger bordered/shadowed card (44px + border + shadow)
// while back/create/status were transparent 40px controls. Every header
// action must now share the same MobileHeaderAction box.
describe('MobileHeader action geometry', () => {
  it('renders create and search actions with identical 44x44 button geometry', () => {
    mockPathname = '/m/incidents';
    render(<MobileHeader systemStatus="ok" canCreateIncident />);

    const create = screen.getByRole('link', { name: 'Create incident' });
    const search = screen.getByRole('button', { name: 'Search OpsKnight' });
    const status = screen.getByRole('link', { name: /System status/i });

    for (const action of [create, search, status]) {
      expect(action.className).toContain('h-11');
      expect(action.className).toContain('w-11');
      expect(action.className).toContain('rounded-xl');
      // None of them may opt into a standalone card look.
      expect(action.className).not.toContain('shadow');
      expect(action.className).not.toContain('bg-card');
    }
  });

  it('hides incident creation from read-only users', () => {
    mockPathname = '/m/incidents';
    render(<MobileHeader systemStatus="neutral" canCreateIncident={false} />);

    expect(screen.queryByRole('link', { name: 'Create incident' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /No operational scope/i })).toBeInTheDocument();
  });

  it('renders the back action with the same shared geometry on detail routes', () => {
    mockPathname = '/m/incidents/inc-1';
    render(<MobileHeader systemStatus="ok" />);

    const back = screen.getByRole('link', { name: /Back to/i });
    expect(back.className).toContain('h-11');
    expect(back.className).toContain('w-11');
  });

  it('names the back target and returns from service automation to that service', () => {
    mockPathname = '/m/services/svc-1/automation';
    render(<MobileHeader systemStatus="ok" />);

    expect(screen.getByRole('link', { name: 'Back to Service' })).toHaveAttribute(
      'href',
      '/m/services/svc-1'
    );
    expect(screen.getByText('Automation')).toBeInTheDocument();
  });

  it('exposes the list route title as the page heading', () => {
    mockPathname = '/m/help';
    render(<MobileHeader systemStatus="ok" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
  });
});
