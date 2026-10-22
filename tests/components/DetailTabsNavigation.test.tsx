import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('navigates once for a real pointer sequence and repeated selection while navigation is pending', async () => {
  render(<DetailTabs tabs={tabs} navigationMode="server" />);
  const tab = screen.getByRole('tab', { name: 'Runbooks' });
  fireEvent.pointerDown(tab, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.pointerUp(tab, { button: 0, pointerType: 'mouse' });
  fireEvent.click(tab);
  fireEvent.click(tab);
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});

it('supports keyboard tab activation without duplicate server navigation', async () => {
  render(<DetailTabs tabs={tabs} navigationMode="server" />);
  const first = screen.getByRole('tab', { name: 'Overview' });
  act(() => first.focus());
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const next = screen.getByRole('tab', { name: 'Runbooks' });
  act(() => next.focus());
  fireEvent.keyDown(next, { key: 'Enter' });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Runbooks' })).toHaveAttribute('aria-selected', 'true')
  );
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});

it('supports controlled tab switching back and forth without dropping click events', async () => {
  function ControlledTabsWrapper() {
    const [current, setCurrent] = React.useState('overview');
    return <DetailTabs tabs={tabs} activeTab={current} onTabChange={setCurrent} />;
  }
  render(<ControlledTabsWrapper />);
  const runbooksTab = screen.getByRole('tab', { name: 'Runbooks' });
  const overviewTab = screen.getByRole('tab', { name: 'Overview' });

  // 1. Switch to Runbooks
  fireEvent.pointerDown(runbooksTab, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(runbooksTab, { button: 0 });
  fireEvent.click(runbooksTab);
  await waitFor(() => expect(runbooksTab).toHaveAttribute('aria-selected', 'true'));

  // 2. Switch back to Overview
  fireEvent.pointerDown(overviewTab, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(overviewTab, { button: 0 });
  fireEvent.click(overviewTab);
  await waitFor(() => expect(overviewTab).toHaveAttribute('aria-selected', 'true'));

  // 3. Switch to Runbooks again (must not be blocked by stale selection ref)
  fireEvent.pointerDown(runbooksTab, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(runbooksTab, { button: 0 });
  fireEvent.click(runbooksTab);
  await waitFor(() => expect(runbooksTab).toHaveAttribute('aria-selected', 'true'));
});
