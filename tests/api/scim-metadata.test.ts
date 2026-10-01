import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getServiceProviderConfig } from '@/app/api/scim/v2/ServiceProviderConfig/route';
import { GET as getResourceTypes } from '@/app/api/scim/v2/ResourceTypes/route';
import { GET as getSchemas } from '@/app/api/scim/v2/Schemas/route';

describe('SCIM Discovery Metadata Endpoints', () => {
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

  it('returns compliant Schemas metadata listing User and Group schemas', async () => {
    const req = new NextRequest('https://ops.example.com/api/scim/v2/Schemas');
    const res = await getSchemas(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/scim+json');

    const body = await res.json();
    expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    expect(body.totalResults).toBe(2);
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
});
