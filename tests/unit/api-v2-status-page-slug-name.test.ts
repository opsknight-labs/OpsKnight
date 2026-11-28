import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isStatusPageSlug } from '@/lib/validation';
import { StatusPageCreateV2Schema, StatusPageUpdateV2Schema } from '@/lib/api-v2/validation';

describe('v2 status page slug', () => {
  const rejected = [
    'verify',
    'postmortems',
    'default',
    'rss',
    '-a--b-',
    'a--b',
    '-ab',
    'ab-',
    'a'.repeat(81),
    'Upper',
    'under_score',
  ];
  const accepted = ['ab', 'status-page-1', 'a'.repeat(80)];

  it.each(rejected)('rejects %s on create and update, as the console does', slug => {
    expect(StatusPageCreateV2Schema.safeParse({ name: 'Status', slug }).success).toBe(false);
    expect(StatusPageUpdateV2Schema.safeParse({ slug }).success).toBe(false);
  });

  it.each(accepted)('accepts %s', slug => {
    expect(isStatusPageSlug(slug)).toBe(true);
    expect(StatusPageCreateV2Schema.safeParse({ name: 'Status', slug }).success).toBe(true);
    expect(StatusPageUpdateV2Schema.safeParse({ slug }).success).toBe(true);
  });
});

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  nameAvailable: vi.fn(),
  applyChange: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { statusPage: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/unique-names', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/unique-names')>()),
  assertStatusPageNameAvailable: mocks.nameAvailable,
}));
vi.mock('@/lib/status-pages/publish-configuration', () => ({
  applyStatusPageConfigurationChange: mocks.applyChange,
}));
vi.mock('@/lib/status-pages/admin', () => ({
  makeDefaultStatusPage: vi.fn(),
  StatusPageAdminError: class extends Error {},
}));
vi.mock('@/lib/api-v2/observability', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v2/observability')>()),
  withV2Observability: <T>(handler: T) => handler,
}));
vi.mock('@/lib/api-v2', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v2')>()),
  authenticateV2Request: vi
    .fn()
    .mockResolvedValue({ apiKey: { id: 'key', name: 'k' }, actor: { id: 'u' } }),
  enforceV2RateLimit: vi.fn().mockResolvedValue({}),
  enforceV2Authorization: vi.fn(),
  logV2Audit: vi.fn(),
}));

import { PATCH } from '@/app/api/v2/status-pages/[id]/route';
import { UniqueNameConflictError } from '@/lib/unique-names';

function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/v2/status-pages/page-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'page-1' }) }
  );
}

describe('v2 status page rename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: 'page-1', isDefault: true });
  });

  it('refuses a name another status page already uses, as the console does', async () => {
    mocks.nameAvailable.mockRejectedValue(new UniqueNameConflictError('Status page', 'Taken'));

    const response = await patch({ name: 'Taken' });

    expect(response.status).toBe(400);
    expect(mocks.nameAvailable).toHaveBeenCalledWith('Taken', { excludeId: 'page-1' });
    expect(mocks.applyChange).not.toHaveBeenCalled();
  });
});
