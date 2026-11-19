import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SystemLogsPage from '@/app/(app)/system-logs/page';
import SystemLogsError from '@/app/(app)/system-logs/error';
import * as navigation from 'next/navigation';
import * as rbac from '@/lib/rbac';
import * as loggerModule from '@/lib/logger';

vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  forbidden: vi.fn(() => {
    throw new Error('NEXT_FORBIDDEN');
  }),
}));

const permissions = (role: 'ADMIN' | 'RESPONDER' | null) =>
  ({
    id: role ? `${role.toLowerCase()}-1` : '',
    authenticated: role !== null,
    role,
    capabilities: role === 'ADMIN' ? ['admin.manage'] : role ? ['operations.manage'] : [],
    isAdmin: role === 'ADMIN',
    isAuditor: false,
    isAdminOrResponder: role !== null,
    isResponderOrAbove: role !== null,
  }) as unknown as Awaited<ReturnType<typeof rbac.getUserPermissions>>;

vi.mock('@/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    getLogBuffer: vi.fn(),
    logger: {
      ...actual.logger,
      error: vi.fn(),
    },
  };
});

type MockLogEntry = {
  level: string;
  message: string;
  timestamp: string;
  component?: string;
  duration?: number;
  error?: {
    message?: string;
    stack?: string;
    name?: string;
  };
};

describe('SystemLogsPage & SystemLogsError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends unauthenticated people to sign in and back', async () => {
    vi.mocked(rbac.getUserPermissions).mockResolvedValueOnce(permissions(null));

    await expect(SystemLogsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/login?callbackUrl=%2Fsystem-logs'
    );
  });

  it('shows the Access denied page to non-admins instead of silently redirecting', async () => {
    vi.mocked(rbac.getUserPermissions).mockResolvedValueOnce(permissions('RESPONDER'));

    await expect(SystemLogsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_FORBIDDEN'
    );
    expect(navigation.forbidden).toHaveBeenCalled();
  });

  it('renders log entries including fallback configs and missing fields safely', async () => {
    vi.mocked(rbac.getUserPermissions).mockResolvedValueOnce(permissions('ADMIN'));

    const mockLogs: MockLogEntry[] = [
      {
        level: 'info',
        message: 'System initialization complete',
        timestamp: '2026-10-01T12:00:00.000Z',
        component: 'bootstrap',
      },
      {
        level: 'fatal', // unmapped level test
        message: 'Unexpected crash report',
        timestamp: 'invalid-date', // invalid timestamp test
        component: 'engine',
        error: { stack: 'at foo.bar()' }, // missing error.message test
      },
      {
        level: 'warn',
        message: '',
        timestamp: '2026-10-01T12:02:00.000Z',
      },
    ];

    vi.mocked(loggerModule.getLogBuffer).mockReturnValueOnce(
      mockLogs as unknown as ReturnType<typeof loggerModule.getLogBuffer>
    );

    const pageElement = await SystemLogsPage({ searchParams: Promise.resolve({}) });
    render(pageElement);

    expect(screen.getByText('System Logs')).toBeDefined();
    expect(screen.getByText('System initialization complete')).toBeDefined();
    expect(screen.getByText('Unexpected crash report')).toBeDefined();
    expect(screen.getByText('(no message)')).toBeDefined();
    expect(screen.getByText('bootstrap')).toBeDefined();
  });

  it('filters by search keyword safely even when error message or component are missing', async () => {
    vi.mocked(rbac.getUserPermissions).mockResolvedValueOnce(permissions('ADMIN'));

    const filterLogs: MockLogEntry[] = [
      {
        level: 'error',
        message: 'Database connection failed',
        timestamp: '2026-10-01T12:00:00.000Z',
        component: 'database',
      },
      {
        level: 'info',
        message: 'Worker healthcheck ok',
        timestamp: '2026-10-01T12:01:00.000Z',
        component: 'worker',
      },
    ];

    vi.mocked(loggerModule.getLogBuffer).mockReturnValueOnce(
      filterLogs as unknown as ReturnType<typeof loggerModule.getLogBuffer>
    );

    const pageElement = await SystemLogsPage({
      searchParams: Promise.resolve({ search: 'database' }),
    });
    render(pageElement);

    expect(screen.getByText('Database connection failed')).toBeDefined();
    expect(screen.queryByText('Worker healthcheck ok')).toBeNull();
  });

  it('renders SystemLogsError boundary and triggers reset on retry', () => {
    const resetMock = vi.fn();
    const errorObj = new Error('Test render crash');

    render(<SystemLogsError error={errorObj} reset={resetMock} />);

    expect(screen.getByText("System logs couldn't load")).toBeDefined();
    expect(loggerModule.logger.error).toHaveBeenCalledWith(
      '[SystemLogs] Render error',
      expect.objectContaining({ message: 'Test render crash' })
    );

    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);
    expect(resetMock).toHaveBeenCalledTimes(1);
  });

  it('is exposed as an admin-only setting in settings navigation config', async () => {
    const { SETTINGS_NAV_ITEMS } = await import('@/components/settings/navConfig');
    const { resolvePageAccess } = await import('@/lib/access/pages');
    expect(SETTINGS_NAV_ITEMS).toContainEqual(
      expect.objectContaining({ id: 'system-logs', href: '/system-logs' })
    );
    expect(resolvePageAccess('/system-logs')?.anyOf).toEqual(['admin.manage']);
  });
});
