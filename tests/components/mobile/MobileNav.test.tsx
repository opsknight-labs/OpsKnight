import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileNav from '@/components/mobile/MobileNav';

let mockPathname = '/m';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('@/hooks/useNotificationStream', () => ({
  useNotificationStream: vi.fn(),
}));

describe('MobileNav', () => {
  beforeEach(() => {
    mockPathname = '/m';
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div class="mobile-app">
        <main class="mobile-content"></main>
      </div>
    `;
  });

  it('renders all 5 navigation items on home route', () => {
    render(<MobileNav />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAttribute('href', '/m');
    expect(links[1]).toHaveAttribute('href', '/m/incidents');
    expect(links[2]).toHaveAttribute('href', '/m/schedules');
    expect(links[3]).toHaveAttribute('href', '/m/notifications');
    expect(links[4]).toHaveAttribute('href', '/m/more');
  });

  it('marks the current active item with aria-current="page"', () => {
    mockPathname = '/m/incidents';
    render(<MobileNav />);
    const incidentLink = screen.getByRole('link', { name: /incidents/i });
    expect(incidentLink).toHaveAttribute('aria-current', 'page');
    expect(incidentLink.className).toContain('active');
  });

  it('highlights More tab when on a secondary route like /m/services', () => {
    mockPathname = '/m/services';
    render(<MobileNav />);
    const moreLink = screen.getByRole('link', { name: /more/i });
    expect(moreLink).toHaveAttribute('aria-current', 'page');
    expect(moreLink.className).toContain('active');
  });

  it('highlights More tab when on /m/help', () => {
    mockPathname = '/m/help';
    render(<MobileNav />);
    const moreLink = screen.getByRole('link', { name: /more/i });
    expect(moreLink).toHaveAttribute('aria-current', 'page');
    expect(moreLink.className).toContain('active');
  });

  it('syncs data-bottom-nav="present" to the app container', () => {
    render(<MobileNav />);
    const app = document.querySelector('.mobile-app');
    expect(app?.getAttribute('data-bottom-nav')).toBe('present');
  });

  it('returns null and syncs data-bottom-nav="absent" on focused workflow', () => {
    mockPathname = '/m/incidents/inc-123';
    const { container } = render(<MobileNav />);
    expect(container.firstChild).toBeNull();
    const app = document.querySelector('.mobile-app');
    expect(app?.getAttribute('data-bottom-nav')).toBe('absent');
  });

  it('scrolls content to top when tapping an active tab', () => {
    mockPathname = '/m';
    render(<MobileNav />);
    const scrollContainer = document.querySelector('.mobile-content') as HTMLElement;
    scrollContainer.scrollTop = 500;
    const scrollToMock = vi.fn();
    scrollContainer.scrollTo = scrollToMock;

    const homeLink = screen.getByRole('link', { name: /home/i });
    fireEvent.click(homeLink);

    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  // Design-system contract: every destination shares identical item/icon/label
  // geometry classes -- none may opt into a bespoke size, so all five stay
  // visually equal weight and the CSS 44px-minimum/safe-area rules apply
  // uniformly across the row.
  it('gives every destination identical item, icon and label geometry classes', () => {
    render(<MobileNav />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);

    for (const link of links) {
      expect(link.className).toContain('mobile-nav-item');
      const icon = link.querySelector('.mobile-nav-icon');
      const label = link.querySelector('.mobile-nav-label');
      expect(icon).toBeTruthy();
      expect(label).toBeTruthy();
      // Labels must render their full text -- no ellipsis/truncate class that
      // could clip "Incidents" or "Notifications" at compact widths.
      expect(label?.className).not.toMatch(/truncate|overflow-hidden/);
      expect(label?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
