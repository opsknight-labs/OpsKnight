import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getServiceProviderConfig } from '@/app/api/scim/v2/ServiceProviderConfig/route';
import { GET as getResourceTypes } from '@/app/api/scim/v2/ResourceTypes/route';
import { GET as getResourceTypeById } from '@/app/api/scim/v2/ResourceTypes/[id]/route';
import { GET as getSchemas } from '@/app/api/scim/v2/Schemas/route';
import { GET as getSchemaById } from '@/app/api/scim/v2/Schemas/[id]/route';
import { GET as catchallGet, POST as catchallPost } from '@/app/api/scim/v2/[...catchall]/route';

describe('SCIM Discovery Metadata Endpoints', () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    process.env.APP_URL = 'https://ops.example.com';
  });

  afterEach(() => {
    process.env.APP_URL = originalAppUrl;
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

  it('returns RFC 7644 JSON error format for unknown SCIM subroutes via catch-all', async () => {
    const getRes = await catchallGet();
    expect(getRes.status).toBe(404);
    expect(getRes.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
    const getBody = await getRes.json();
    expect(getBody.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(getBody.status).toBe('404');
    expect(getBody.scimType).toBe('invalidPath');
    expect(getBody.detail).toBe('The requested SCIM resource was not found.');

    const postRes = await catchallPost();
    expect(postRes.status).toBe(404);
    expect(postRes.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
    const postBody = await postRes.json();
    expect(postBody.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
  });
});
