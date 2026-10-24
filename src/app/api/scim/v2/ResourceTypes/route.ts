import { NextRequest } from 'next/server';
import {
  SCIM_LIST_SCHEMA,
  SCIM_RESOURCE_TYPE_SCHEMA,
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
} from '@/lib/scim';
import { resolveScimPublicOrigin } from '@/lib/scim/protocol/origin';
import { handle } from '@/lib/scim/protocol/http';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const baseUrl = await resolveScimPublicOrigin();

    const resourceTypes = [
      {
        schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        description: 'OpsKnight User Account',
        schema: SCIM_USER_SCHEMA,
        schemaExtensions: [
          { schema: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User', required: false },
        ],
        meta: {
          resourceType: 'ResourceType',
          location: `${baseUrl}/api/scim/v2/ResourceTypes/User`,
        },
      },
      {
        schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        description: 'OpsKnight Directory Group',
        schema: SCIM_GROUP_SCHEMA,
        meta: {
          resourceType: 'ResourceType',
          location: `${baseUrl}/api/scim/v2/ResourceTypes/Group`,
        },
      },
    ];

    return Response.json(
      {
        schemas: [SCIM_LIST_SCHEMA],
        totalResults: resourceTypes.length,
        startIndex: 1,
        itemsPerPage: resourceTypes.length,
        Resources: resourceTypes,
      },
      {
        headers: {
          'Content-Type': 'application/scim+json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }, request);
}
