import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DetailTabs from '@/components/ui/DetailTabs';
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  usePathname: () => '/services/fixture',
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});
function selectRunbooks() {
  const tab = screen.getByRole('tab', { name: 'Runbooks' });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
}
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'runbooks', label: 'Runbooks' },
];
it('performs one server navigation for service data tabs', () => {
  render(<DetailTabs tabs={tabs} navigationMode="server" />);
  selectRunbooks();
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/services/fixture?tab=runbooks', {
    scroll: false,
  });
});
it('preserves shallow client navigation for settings', () => {
  render(<DetailTabs tabs={tabs} />);
  selectRunbooks();
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?tab=runbooks');
});
it('honors a cancelled settings navigation guard before navigating', () => {
  const guard = (event: Event) => event.preventDefault();
  window.addEventListener('opsknight:settings-navigation', guard);
  try {
    render(<DetailTabs tabs={tabs} navigationMode="server" />);
    selectRunbooks();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  } finally {
    window.removeEventListener('opsknight:settings-navigation', guard);
  }
});
