import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TopbarBreadcrumbs from '@/components/TopbarBreadcrumbs';
import { rememberListUrl } from '@/lib/navigation/list-return';

let currentPathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
    function MockLink({ children, href, className, title }, ref) {
      return (
        <a ref={ref} href={href} className={className} title={title}>
          {children}
        </a>
      );
    }
  ),
}));

const SERVICE_ID = 'cmwj77ata00aga6tx2et76uhb';
const OTHER_SERVICE_ID = 'cmwj88bta00aga6tx2et76uhb';

describe('TopbarBreadcrumbs', () => {
  beforeEach(() => {
    currentPathname = '/';
    window.sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('renders nothing on home page', () => {
    const { container } = render(<TopbarBreadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders readable labels and marks the current page', () => {
    currentPathname = '/settings/integrations';
    render(<TopbarBreadcrumbs />);

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    const current = screen.getByText('Integrations');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('title', 'Integrations');
  });

  it('collapses deep routes behind a menu and keeps the last two crumbs', () => {
    currentPathname = '/settings/integrations/mcp/consent';
    render(<TopbarBreadcrumbs />);

    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 1 more level' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'MCP' })).toBeInTheDocument();
    expect(screen.getByText('Consent')).toHaveAttribute('aria-current', 'page');
  });

  it('names the current entity from the page heading', () => {
    currentPathname = `/services/${SERVICE_ID}`;
    const main = document.createElement('main');
    main.id = 'main-content';
    main.innerHTML = '<h1>Checkout API</h1>';
    document.body.appendChild(main);

    render(<TopbarBreadcrumbs />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Checkout API')).toHaveAttribute('aria-current', 'page');
  });

  it('returns list crumbs to the remembered filtered view', () => {
    act(() => rememberListUrl('/services', '?q=api&page=2'));
    currentPathname = `/services/${OTHER_SERVICE_ID}/settings`;
    render(<TopbarBreadcrumbs />);

    expect(screen.getByRole('link', { name: 'Services' })).toHaveAttribute(
      'href',
      '/services?q=api&page=2'
    );
    expect(screen.getByRole('link', { name: 'Service cmwj88bt' })).toHaveAttribute(
      'href',
      `/services/${OTHER_SERVICE_ID}`
    );
  });
});
