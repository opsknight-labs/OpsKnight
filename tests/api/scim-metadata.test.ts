import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getServiceProviderConfig } from '@/app/api/scim/v2/ServiceProviderConfig/route';
import { GET as getResourceTypes } from '@/app/api/scim/v2/ResourceTypes/route';
import { GET as getResourceTypeById } from '@/app/api/scim/v2/ResourceTypes/[id]/route';
import { GET as getSchemas } from '@/app/api/scim/v2/Schemas/route';
import { GET as getSchemaById } from '@/app/api/scim/v2/Schemas/[id]/route';
import { GET as catchallGet, POST as catchallPost } from '@/app/api/scim/v2/[...catchall]/route';
import {
  clearScimOriginCache,
  parseStrictOrigin,
  isNonPublicDestination,
  validateProductionOrigin,
  resolveScimPublicOrigin,
} from '@/lib/scim/protocol/origin';
import prisma from '@/lib/prisma';

describe('SCIM Discovery Metadata Endpoints', () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalAuthUrl = process.env.NEXTAUTH_URL;
  const originalAllowPrivate = process.env.SCIM_ALLOW_PRIVATE_NETWORK;

  beforeEach(() => {
    clearScimOriginCache();
    process.env.NEXT_PUBLIC_APP_URL = 'https://ops.example.com';
    delete process.env.NEXTAUTH_URL;
    delete process.env.SCIM_ALLOW_PRIVATE_NETWORK;
  });

  afterEach(() => {
    clearScimOriginCache();
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    process.env.NEXTAUTH_URL = originalAuthUrl;
    process.env.SCIM_ALLOW_PRIVATE_NETWORK = originalAllowPrivate;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('returns compliant ServiceProviderConfig metadata', async () => {
    const req = new NextRequest('https://ops.example.com/api/scim/v2/ServiceProviderConfig');
    const res = await getServiceProviderConfig(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/scim+json');

    const body = await res.json();
    expect(body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
    expect(body.patch.supported).toBe(true);
    expect(body.filter.supported).toBe(true);
    expect(body.authenticationSchemes[0].type).toBe('oauthbearertoken');
    expect(body.meta.location).toBe('https://ops.example.com/api/scim/v2/ServiceProviderConfig');
  });

  it('returns compliant ResourceTypes metadata listing User and Group', async () => {
    const req = new NextRequest('https://ops.example.com/api/scim/v2/ResourceTypes');
    const res = await getResourceTypes(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/scim+json');

    const body = await res.json();
    expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    expect(body.totalResults).toBe(2);
    expect(body.Resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'User',
          endpoint: '/Users',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
        }),
        expect.objectContaining({
          id: 'Group',
          endpoint: '/Groups',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
        }),
      ])
    );
  });

  it('returns single ResourceType by id and 404 for unknown type', async () => {
    const req = new NextRequest('https://ops.example.com/api/scim/v2/ResourceTypes/Group');
    const res = await getResourceTypeById(req, { params: Promise.resolve({ id: 'Group' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('Group');
    expect(body.endpoint).toBe('/Groups');

    const notFoundReq = new NextRequest(
      'https://ops.example.com/api/scim/v2/ResourceTypes/Unknown'
    );
    const notFoundRes = await getResourceTypeById(notFoundReq, {
      params: Promise.resolve({ id: 'Unknown' }),
    });
    expect(notFoundRes.status).toBe(404);
  });

  it('returns compliant Schemas metadata listing User and Group schemas', async () => {
    const req = new NextRequest('https://ops.example.com/api/scim/v2/Schemas');
    const res = await getSchemas(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/scim+json');

    const body = await res.json();
    expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    expect(body.totalResults).toBe(3);
    expect(body.Resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'urn:ietf:params:scim:schemas:core:2.0:User',
          name: 'User',
        }),
        expect.objectContaining({
          id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
          name: 'Group',
        }),
      ])
    );
  });

  it('returns single Schema by id and 404 for unknown schema', async () => {
    const schemaUri = 'urn:ietf:params:scim:schemas:core:2.0:Group';
    const req = new NextRequest(
      `https://ops.example.com/api/scim/v2/Schemas/${encodeURIComponent(schemaUri)}`
    );
    const res = await getSchemaById(req, {
      params: Promise.resolve({ id: encodeURIComponent(schemaUri) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(schemaUri);
    expect(body.name).toBe('Group');

    const notFoundReq = new NextRequest('https://ops.example.com/api/scim/v2/Schemas/invalid');
    const notFoundRes = await getSchemaById(notFoundReq, {
      params: Promise.resolve({ id: 'invalid' }),
    });
    expect(notFoundRes.status).toBe(404);
  });

  it('preserves canonical public origin and rejects untrusted forwarded headers', async () => {
    const maliciousReq = new NextRequest('http://0.0.0.0:3000/api/scim/v2/ServiceProviderConfig', {
      headers: {
        'x-forwarded-host': 'attacker.example.com',
        'x-forwarded-proto': 'http',
        host: '0.0.0.0:3000',
      },
    });

    const res = await getServiceProviderConfig(maliciousReq);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.location).toBe('https://ops.example.com/api/scim/v2/ServiceProviderConfig');
    expect(body.meta.location).not.toContain('0.0.0.0:3000');
    expect(body.meta.location).not.toContain('attacker.example.com');
  });

  it('returns RFC 7644 JSON error format for unknown SCIM subroutes via catch-all without invalidPath', async () => {
    const getRes = await catchallGet();
    expect(getRes.status).toBe(404);
    expect(getRes.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
    const getBody = await getRes.json();
    expect(getBody.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(getBody.status).toBe('404');
    expect(getBody.scimType).toBeUndefined(); // RFC 7644 §3.12: scimType is omitted for 404
    expect(getBody.detail).toBe('The requested SCIM resource was not found.');

    const postRes = await catchallPost();
    expect(postRes.status).toBe(404);
    expect(postRes.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
    const postBody = await postRes.json();
    expect(postBody.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(postBody.scimType).toBeUndefined();
  });

  it('strictly parses URLs and strips paths, query strings, and fragments', () => {
    expect(parseStrictOrigin('https://example.com/some/path?query=1#frag')).toBe(
      'https://example.com'
    );
    expect(parseStrictOrigin('https://example.com:8443/api/v2')).toBe('https://example.com:8443');
    expect(parseStrictOrigin('http://user:pass@example.com/')).toBeNull(); // Disallow credentials
    expect(parseStrictOrigin('ftp://example.com')).toBeNull(); // Disallow non-HTTP
    expect(parseStrictOrigin('')).toBeNull();
  });

  it('detects non-public loopback, private IP, and bind destinations', () => {
    expect(isNonPublicDestination('http://localhost:3000')).toBe(true);
    expect(isNonPublicDestination('https://127.0.0.1')).toBe(true);
    expect(isNonPublicDestination('https://0.0.0.0:3000')).toBe(true);
    expect(isNonPublicDestination('https://10.0.0.1')).toBe(true);
    expect(isNonPublicDestination('https://172.16.0.1')).toBe(true);
    expect(isNonPublicDestination('https://192.168.1.1')).toBe(true);
    expect(isNonPublicDestination('https://169.254.169.254')).toBe(true); // Cloud metadata
    expect(isNonPublicDestination('http://[::1]:8080')).toBe(true);
    expect(isNonPublicDestination('https://[fe80::1]')).toBe(true);
    expect(isNonPublicDestination('https://[fc00::1]')).toBe(true);
    expect(isNonPublicDestination('http://app.localhost')).toBe(true);
    expect(isNonPublicDestination('https://corp.internal')).toBe(true);
    expect(isNonPublicDestination('https://service.local')).toBe(true);
    expect(isNonPublicDestination('https://opssentinal.com')).toBe(false);
  });

  it('enforces HTTPS and rejects non-public destinations in production validation', () => {
    // HTTPS required
    expect(() => validateProductionOrigin('http://public.example.com')).toThrow(
      'SCIM service configuration'
    );
    expect(() => validateProductionOrigin('https://public.example.com')).not.toThrow();

    // Private addresses rejected in production
    expect(() => validateProductionOrigin('https://127.0.0.1')).toThrow(
      'SCIM service configuration'
    );
    expect(() => validateProductionOrigin('https://10.0.0.1')).toThrow(
      'SCIM service configuration'
    );
    expect(() => validateProductionOrigin('https://169.254.169.254')).toThrow(
      'SCIM service configuration'
    );

    // Private deployment override supported via SCIM_ALLOW_PRIVATE_NETWORK=true
    process.env.SCIM_ALLOW_PRIVATE_NETWORK = 'true';
    expect(() => validateProductionOrigin('http://internal.corp:8080')).not.toThrow();
    expect(() => validateProductionOrigin('https://10.0.0.5')).not.toThrow();
  });

  it('prevents concurrent cold-cache requests from producing duplicate PostgreSQL lookups', async () => {
    const findUniqueSpy = prisma?.systemSettings
      ? vi.spyOn(prisma.systemSettings, 'findUnique').mockImplementation(() => {
          return new Promise(r => {
            setTimeout(() => {
              r({ id: 'default', appUrl: 'https://db.example.com' } as unknown as Awaited<
                ReturnType<typeof prisma.systemSettings.findUnique>
              >);
            }, 20);
          }) as unknown as ReturnType<typeof prisma.systemSettings.findUnique>;
        })
      : null;

    findUniqueSpy?.mockClear();

    // Launch 10 simultaneous requests on cold cache
    const results = await Promise.all(Array.from({ length: 10 }, () => resolveScimPublicOrigin()));

    expect(results).toHaveLength(10);
    results.forEach(res => expect(res).toBe('https://db.example.com'));

    if (findUniqueSpy) {
      // Exactly 1 DB lookup executed; the other 9 shared the in-flight promise
      expect(findUniqueSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('gracefully falls back to environment when database is degraded and caches result', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://fallback.example.com/app';
    if (prisma?.systemSettings) {
      vi.spyOn(prisma.systemSettings, 'findUnique').mockRejectedValueOnce(
        new Error('PostgreSQL connection timeout')
      );
    }

    const origin = await resolveScimPublicOrigin();
    expect(origin).toBe('https://fallback.example.com');

    // Subsequent call should use bounded cache
    const cached = await resolveScimPublicOrigin();
    expect(cached).toBe('https://fallback.example.com');
  });

  it('returns consistent SCIM JSON error envelope when origin is unconfigured in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;

    if (prisma?.systemSettings) {
      vi.spyOn(prisma.systemSettings, 'findUnique').mockResolvedValueOnce(null);
    }

    const req = new NextRequest('https://ops.example.com/api/scim/v2/ServiceProviderConfig');
    const res = await getServiceProviderConfig(req);

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
    expect(res.headers.get('x-request-id')).toBeDefined();

    const body = await res.json();
    expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(body.status).toBe('500');
    expect(body.detail).toBe(
      'An internal error occurred resolving the SCIM service configuration.'
    );
    // Ensure no internal env variable names or DB connection details leak
    expect(body.detail).not.toContain('NEXT_PUBLIC_APP_URL');
    expect(body.detail).not.toContain('PostgreSQL');
  });
});
