import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TopbarBreadcrumbs from '@/components/TopbarBreadcrumbs';

let currentPathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className, title }: any) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

describe('TopbarBreadcrumbs', () => {
  beforeEach(() => {
    currentPathname = '/';
  });

  it('renders nothing on home page', () => {
    const { container } = render(<TopbarBreadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders collapsed breadcrumbs with ellipsis for deep routes', () => {
    currentPathname = '/settings/status-pages/cmkk2vriy0005nxa3bzkz05cx';
    render(<TopbarBreadcrumbs />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Toggle menu')).toBeInTheDocument();
    expect(screen.getByText('Status Pages')).toBeInTheDocument();
    expect(screen.getByText('cmkk2vriy0005nxa3bzkz05cx')).toBeInTheDocument();
  });

  it('renders standard breadcrumbs for 2-segment routes without ellipsis', () => {
    currentPathname = '/settings/status-pages';
    render(<TopbarBreadcrumbs />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Toggle menu')).not.toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Status Pages')).toBeInTheDocument();
  });
});
