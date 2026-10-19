import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuthenticationConsole from '@/components/settings/AuthenticationConsole';
import { fixtureDashboard } from '../helpers/authentication-dashboard';
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/settings/system',
  useSearchParams: () => new URLSearchParams('section=sso&authTab=diagnostics'),
}));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/components/settings/AuthenticationDiagnostics', () => ({
  default: ({ onRevoke }: { onRevoke: (id: string) => Promise<boolean> }) => (
    <button onClick={() => void onRevoke('opaque-session-row')}>Revoke selected session</button>
  ),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockClear();
});
describe('session revocation completion', () => {
  it.each([true, false])(
    'handles self=%s without treating a committed revocation as failure',
    async self => {
      const data = { ...fixtureDashboard, section: 'diagnostics' as const };
      const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
        options?.method === 'POST'
          ? Response.json({ data: { success: true, revokedCurrentSession: self } })
          : Response.json({ data })
      );
      vi.stubGlobal('fetch', fetcher);
      window.history.replaceState(null, '', '/settings/system?section=sso&authTab=diagnostics');
      render(
        <AuthenticationConsole
          initialData={data}
          callbackUrl="https://ops.example.test/api/auth/callback/oidc"
          testCallbackUrl="https://ops.example.test/api/auth/oidc/test/callback"
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Revoke selected session' }));
      await screen.findByText(
        self
          ? 'Your session was revoked successfully. Sign in again to continue.'
          : 'Session revoked successfully.'
      );
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(self ? 1 : 2));
      if (self) expect(replace).toHaveBeenCalledWith('/login?sessionRevoked=1');
      else expect(replace).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/session ended or was revoked|Unable to complete operation/)
      ).not.toBeInTheDocument();
    }
  );
});
