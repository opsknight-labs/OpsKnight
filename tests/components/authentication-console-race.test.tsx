import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import { fixtureDashboard } from '../helpers/authentication-dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/components/ui/DetailTabs', () => ({
  default: ({
    tabs,
    onTabChange,
    children,
  }: {
    tabs: Array<{ id: string; label: string }>;
    onTabChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <div>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onTabChange(tab.id)}>
          {tab.label}
        </button>
      ))}
      {children}
    </div>
  ),
  DetailTabContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('authentication section request cancellation', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  afterEach(() => vi.unstubAllGlobals());
  it('returns to an already-loaded section without leaving actions blocked by an aborted request', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => {
      resolve = done;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending)
    );
    const data = fixtureDashboard;
    render(
      <AuthenticationConsole
        initialData={data}
        callbackUrl="https://instance.example.test/api/auth/callback/oidc"
        testCallbackUrl="https://instance.example.test/api/auth/oidc/test/callback"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Identity Provider' }));
    expect(screen.getByText('Loading this section…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.queryByText('Loading this section…')).not.toBeInTheDocument();
    await act(async () => {
      resolve(Response.json({ data: { ...data, section: 'connection' } }));
    });
    expect(screen.getByRole('heading', { name: 'Configure Enterprise SSO' })).toBeInTheDocument();
    expect(screen.queryByText('Loading this section…')).not.toBeInTheDocument();
  });
});
