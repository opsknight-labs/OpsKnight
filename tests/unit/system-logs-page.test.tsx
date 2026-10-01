import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SystemLogsPage from '@/app/(app)/system-logs/page';
import SystemLogsError from '@/app/(app)/system-logs/error';
import * as nextAuth from 'next-auth';
import * as navigation from 'next/navigation';
import * as loggerModule from '@/lib/logger';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

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

describe('SystemLogsPage & SystemLogsError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects unauthenticated users to /login', async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce(null);

    await SystemLogsPage({ searchParams: Promise.resolve({}) });

    expect(navigation.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects non-admin users to /', async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce({
      user: { email: 'responder@example.com', role: 'RESPONDER' },
      expires: '1h',
    });

    await SystemLogsPage({ searchParams: Promise.resolve({}) });

    expect(navigation.redirect).toHaveBeenCalledWith('/');
  });

  it('renders log entries including fallback configs and missing fields safely', async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce({
      user: { email: 'admin@example.com', role: 'ADMIN' },
      expires: '1h',
    });

    vi.mocked(loggerModule.getLogBuffer).mockReturnValueOnce([
      {
        level: 'info' as any,
        message: 'System initialization complete',
        timestamp: '2026-10-01T12:00:00.000Z',
        component: 'bootstrap',
      },
      {
        level: 'fatal' as any, // unmapped level test
        message: 'Unexpected crash report',
        timestamp: 'invalid-date', // invalid timestamp test
        component: 'engine',
        error: { stack: 'at foo.bar()' } as any, // missing error.message test
      },
      {
        level: 'warn' as any,
        message: '',
        timestamp: '2026-10-01T12:02:00.000Z',
      },
    ]);

    const pageElement = await SystemLogsPage({ searchParams: Promise.resolve({}) });
    render(pageElement);

    expect(screen.getByText('System Logs')).toBeDefined();
    expect(screen.getByText('System initialization complete')).toBeDefined();
    expect(screen.getByText('Unexpected crash report')).toBeDefined();
    expect(screen.getByText('(no message)')).toBeDefined();
    expect(screen.getByText('bootstrap')).toBeDefined();
  });

  it('filters by search keyword safely even when error message or component are missing', async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce({
      user: { email: 'admin@example.com', role: 'ADMIN' },
      expires: '1h',
    });

    vi.mocked(loggerModule.getLogBuffer).mockReturnValueOnce([
      {
        level: 'error' as any,
        message: 'Database connection failed',
        timestamp: '2026-10-01T12:00:00.000Z',
        component: 'database',
      },
      {
        level: 'info' as any,
        message: 'Worker healthcheck ok',
        timestamp: '2026-10-01T12:01:00.000Z',
        component: 'worker',
      },
    ]);

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

  it('is exposed as an admin setting in settings navigation config', async () => {
    const { SETTINGS_NAV_ITEMS } = await import('@/components/settings/navConfig');
    expect(SETTINGS_NAV_ITEMS).toContainEqual(
      expect.objectContaining({
        id: 'system-logs',
        href: '/system-logs',
        requiresAdmin: true,
      })
    );
  });
});
