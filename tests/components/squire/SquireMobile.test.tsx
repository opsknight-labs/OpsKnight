import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/', refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const server = vi.hoisted(() => ({
  status: {
    squireEnabled: true,
    squireName: 'Pip',
    squireAvatar: 'SQUIRE',
    squireLauncher: 'FLOATING',
    squireAnimations: false,
    aiEnabled: false,
    historyEnabled: false,
    historyRetentionDays: 90,
    mobileEnabled: true,
  },
  role: 'RESPONDER',
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentAuthorizationActor: async () => ({
    id: 'u1',
    role: server.role,
    status: 'ACTIVE',
    teamIds: [],
  }),
}));
vi.mock('@/lib/intelligence/ai/settings', () => ({
  getAiPublicStatus: async () => server.status,
}));
// The real lazy wrapper uses next/dynamic; the mount is tested with the launcher itself.
vi.mock('@/components/squire/LazySquireLauncher', async () => ({
  default: (await import('@/components/squire/SquireLauncher')).default,
}));

import MobileSquireMount from '@/components/squire/MobileSquireMount';
import SquireLauncher from '@/components/squire/SquireLauncher';

function emptyStream() {
  const encoder = new TextEncoder();
  const chunks = [
    { type: 'meta', mode: 'basic', name: 'Pip' },
    { type: 'delta', text: 'Here is what I know.' },
    { type: 'done' },
  ].map(event => encoder.encode(`${JSON.stringify(event)}\n`));
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
      }),
    },
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  nav.pathname = '/m/incidents/inc_9';
  server.status = { ...server.status, squireEnabled: true, mobileEnabled: true };
  server.role = 'RESPONDER';
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(emptyStream());
  vi.stubGlobal('fetch', fetchMock);
});

describe('Squire on mobile incident pages', () => {
  it('mounts the launcher full screen when the assistant and its mobile surface are on', async () => {
    render(await MobileSquireMount());
    const launcher = screen.getByRole('button', { name: /Ask Pip/ });
    expect(launcher.closest('[data-presentation]')).toHaveAttribute(
      'data-presentation',
      'fullscreen'
    );
    fireEvent.click(launcher);
    const dialog = screen.getByRole('dialog', { name: /Pip/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Full screen at every width: no desktop panel sizing.
    expect(dialog.className).not.toMatch(/sm:w-/);
    expect(screen.queryByRole('button', { name: 'Expand chat' })).toBeNull();
  });

  it('renders nothing while the mobile surface is off (the default)', async () => {
    server.status = { ...server.status, mobileEnabled: false };
    expect(await MobileSquireMount()).toBeNull();
  });

  it('renders nothing for a person without assistant access', async () => {
    server.role = 'NO_SUCH_ROLE';
    expect(await MobileSquireMount()).toBeNull();
  });

  it('asks about the mobile page incident', async () => {
    render(<SquireLauncher name="Pip" fullscreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), {
      target: { value: 'what changed?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(body.incidentId).toBe('inc_9');
    expect(body.pageContext).toBeUndefined();
  });

  it('passes a mobile service page as page context', async () => {
    nav.pathname = '/m/services/svc_1';
    render(<SquireLauncher name="Pip" fullscreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), {
      target: { value: 'who is on call?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(body.incidentId).toBeUndefined();
    expect(body.pageContext).toEqual({ kind: 'service', id: 'svc_1' });
  });
});
