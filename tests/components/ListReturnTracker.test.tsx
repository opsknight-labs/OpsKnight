import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/incidents';
let search = 'status=OPEN';
const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push }),
}));

import ListReturnTracker from '@/components/layout/ListReturnTracker';

function addLink(container: HTMLElement, href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = 'Back';
  container.appendChild(link);
  return link;
}

describe('ListReturnTracker', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    push.mockClear();
    document.body.innerHTML = '';
  });

  it('returns up-navigation from a detail page to the remembered list view', () => {
    // Visit the filtered list, then a detail page.
    pathname = '/incidents';
    search = 'status=OPEN';
    const { rerender } = render(<ListReturnTracker />);
    pathname = '/incidents/abc';
    search = '';
    window.history.pushState({}, '', '/incidents/abc');
    rerender(<ListReturnTracker />);

    const main = document.createElement('main');
    main.id = 'main-content';
    document.body.appendChild(main);
    const back = addLink(main, '/incidents');
    const outside = addLink(document.body, '/incidents');

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    back.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith('/incidents?status=OPEN');

    push.mockClear();
    const sidebarClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    outside.dispatchEvent(sidebarClick);
    expect(push).not.toHaveBeenCalled();

    const newTab = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    back.dispatchEvent(newTab);
    expect(push).not.toHaveBeenCalled();
  });
});
