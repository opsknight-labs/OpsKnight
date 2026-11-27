// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  config: null as null | Record<string, unknown>,
  installations: vi.fn(),
  groupBy: vi.fn(),
  count: vi.fn(),
  probe: vi.fn(),
  version: vi.fn(),
  squireOn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    microsoftTeamsInstallation: { findMany: m.installations },
    incidentWarRoom: { groupBy: m.groupBy, count: m.count },
  },
}));
vi.mock('@/lib/microsoft-teams/auth', () => ({
  getMicrosoftTeamsConfig: vi.fn(async () =>
    m.config ? { config: m.config, clientSecret: 'secret' } : null
  ),
}));
vi.mock('@/lib/microsoft-teams/graph/credentials', () => ({
  probeMicrosoftTeamsCredentials: m.probe,
  getInstalledTeamsAppVersion: m.version,
}));
vi.mock('@/lib/chatops/squire/switches', () => ({ isSquireChatOpsEnabled: m.squireOn }));

import {
  compareTeamsAppVersions,
  getMicrosoftTeamsHealthChecklist,
} from '@/lib/microsoft-teams/health-checklist';
import { MICROSOFT_TEAMS_MANIFEST_VERSION } from '@/lib/microsoft-teams/app-manifest';

const NOW = new Date('2026-11-27T12:00:00Z');
const byId = (checks: Array<{ id: string }>, id: string) =>
  checks.find(c => c.id === id) as unknown as { status: string; detail: string; code?: string };

beforeEach(() => {
  vi.clearAllMocks();
  m.config = {
    clientId: 'bot-app',
    tenantId: 'tenant-a',
    tenantMode: 'SINGLE',
    clientSecretExpiresAt: new Date('2026-12-02T23:59:59Z'),
  };
  m.installations.mockResolvedValue([
    {
      tenantId: 'tenant-a',
      teamId: 'team-1',
      teamName: 'Ops',
      lastActivityAt: new Date(NOW.getTime() - 3 * 3_600_000),
    },
  ]);
  m.groupBy.mockResolvedValue([{ providerContainerId: 'team-1', _count: { _all: 850 } }]);
  m.count.mockResolvedValue(0);
  m.probe.mockResolvedValue({ ok: true });
  m.version.mockResolvedValue({ ok: true, version: '1.3.0' });
  m.squireOn.mockResolvedValue(false);
});

describe('Teams health checklist', () => {
  it('compares app versions numerically', () => {
    expect(compareTeamsAppVersions('1.3.0', '1.4.0')).toBeLessThan(0);
    expect(compareTeamsAppVersions('1.10.0', '1.4.0')).toBeGreaterThan(0);
    expect(compareTeamsAppVersions('1.4', '1.4.0')).toBe(0);
  });

  it('flags an outdated package, a soon-expiring secret, Squire off and a near-full Team', async () => {
    const result = await getMicrosoftTeamsHealthChecklist({
      now: NOW,
      rscState: { granted: [], missing: [], unknown: false, installations: [] },
    });
    expect(result.currentAppVersion).toBe(MICROSOFT_TEAMS_MANIFEST_VERSION);
    expect(result.appUpdateAvailable).toBe(true);
    expect(result.installedAppVersion).toBe('1.3.0');
    expect(byId(result.checks, 'credentials').status).toBe('pass');
    expect(byId(result.checks, 'app_version')).toMatchObject({
      status: 'warn',
      code: 'APP_UPDATE_AVAILABLE',
    });
    expect(byId(result.checks, 'secret_expiry')).toMatchObject({ status: 'warn', code: 'URGENT' });
    expect(byId(result.checks, 'squire_chat').status).toBe('warn');
    expect(byId(result.checks, 'channel_capacity').status).toBe('warn');
    expect(byId(result.checks, 'permissions').status).toBe('pass');
    expect(byId(result.checks, 'inbound_activity').detail).toContain('3 hours ago');
  });

  it('fails the tenant check when SINGLE mode has no tenant ID', async () => {
    m.config!.tenantId = null;
    const result = await getMicrosoftTeamsHealthChecklist({ now: NOW });
    expect(byId(result.checks, 'tenant')).toMatchObject({
      status: 'fail',
      code: 'TENANT_REQUIRED',
    });
    // The credential probe falls back to an installed tenant.
    expect(m.probe).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
  });

  it('surfaces precise credential errors and channel-cap failures', async () => {
    m.probe.mockResolvedValue({
      ok: false,
      code: 'SECRET_EXPIRED',
      message: 'The client secret has expired.',
    });
    m.count.mockResolvedValue(2);
    m.version.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    const result = await getMicrosoftTeamsHealthChecklist({ now: NOW });
    expect(byId(result.checks, 'credentials')).toMatchObject({
      status: 'fail',
      code: 'SECRET_EXPIRED',
    });
    expect(byId(result.checks, 'channel_capacity').status).toBe('fail');
    expect(byId(result.checks, 'app_version')).toMatchObject({
      status: 'unknown',
      code: 'VERSION_UNREADABLE',
    });
    expect(byId(result.checks, 'permissions').status).toBe('unknown');
  });

  it('never throws when a probe fails', async () => {
    m.installations.mockRejectedValue(new Error('db down'));
    m.probe.mockRejectedValue(new Error('boom'));
    const result = await getMicrosoftTeamsHealthChecklist({ now: NOW });
    expect(byId(result.checks, 'credentials').status).toBe('unknown');
    expect(byId(result.checks, 'installation').status).toBe('fail');
  });

  it('returns a single not-connected row without config', async () => {
    m.config = null;
    const result = await getMicrosoftTeamsHealthChecklist({ now: NOW });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      id: 'credentials',
      status: 'fail',
      code: 'NOT_CONFIGURED',
    });
  });
});
