import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import ContentScrollReset from '@/components/layout/ContentScrollReset';

let currentPathname = '/settings/incident-sla';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

describe('ContentScrollReset', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resets .content-shell scrollTop to 0 on route change', () => {
    const contentShell = document.createElement('div');
    contentShell.className = 'content-shell';
    contentShell.scrollTop = 250;
    document.body.appendChild(contentShell);

    const { rerender } = render(<ContentScrollReset />);
    expect(contentShell.scrollTop).toBe(0);

    // Simulate scroll and route change
    contentShell.scrollTop = 180;
    currentPathname = '/settings/integrations/chatops';
    rerender(<ContentScrollReset />);

    expect(contentShell.scrollTop).toBe(0);
  });
});
