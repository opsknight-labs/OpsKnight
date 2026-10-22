import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/prisma', () => ({ default: { scimIdentity: { findFirst: vi.fn() } } }));
vi.mock('@/lib/scim/security/credentials', () => ({
  authorize: vi.fn(),
  recheck: vi.fn(),
  authenticate: vi.fn(),
  scopes: [],
  createCredential: vi.fn(),
}));
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
import prisma from '@/lib/prisma';
import { authorize } from '@/lib/scim/security/credentials';
import { ScimFailure } from '@/lib/scim/protocol/validation';
import { GET, POST } from '@/app/api/scim/v2/Users/route';
import { GET as resource } from '@/app/api/scim/v2/Users/[id]/route';
const principal = {
  connectorId: 'source-a',
  credentialId: 'key-a',
  scopes: ['users:read', 'users:write'],
};
describe('SCIM Users HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorize).mockResolvedValue(principal);
  });
  it('uses SCIM errors and challenge headers for invalid credentials', async () => {
    vi.mocked(authorize).mockRejectedValue(new ScimFailure(401, 'Invalid credential.'));
    const response = await GET(new NextRequest('https://ops.test/api/scim/v2/Users'));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect(response.headers.get('content-type')).toContain('application/scim+json');
  });
  it('returns a retryable, sanitized outage without environment fallback', async () => {
    vi.mocked(authorize).mockRejectedValue(new Error('secret database connection string'));
    const response = await GET(new NextRequest('https://ops.test/api/scim/v2/Users'));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.text()).not.toContain('secret database');
  });
  it('rejects malformed JSON, missing immutable mappings and privilege fields', async () => {
    for (const body of [
      '{',
      JSON.stringify({ userName: 'a@example.test' }),
      JSON.stringify({ userName: 'a@example.test', externalId: '1', roles: ['ADMIN'] }),
    ]) {
      expect(
        (
          await POST(
            new NextRequest('https://ops.test/api/scim/v2/Users', { method: 'POST', body })
          )
        ).status
      ).toBe(400);
    }
  });
  it('scopes resource IDs to a live connector binding', async () => {
    vi.mocked(prisma.scimIdentity.findFirst).mockResolvedValue(null);
    const response = await resource(
      new NextRequest('https://ops.test/api/scim/v2/Users/local-id'),
      { params: Promise.resolve({ id: 'local-id' }) }
    );
    expect(response.status).toBe(404);
    expect(prisma.scimIdentity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectorId: 'source-a', userId: 'local-id', deletedAt: null },
      })
    );
  });
  it('requires users read and write scopes separately', async () => {
    await POST(
      new NextRequest('https://ops.test/api/scim/v2/Users', { method: 'POST', body: '{}' })
    );
    expect(authorize).toHaveBeenCalledWith(expect.anything(), 'users:write');
    await GET(new NextRequest('https://ops.test/api/scim/v2/Users?count=1.5'));
    expect(authorize).toHaveBeenCalledWith(expect.anything(), 'users:read');
  });
});
