import { NextRequest } from 'next/server';
import {
  SCIM_RESOURCE_TYPE_SCHEMA,
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  scimError,
} from '@/lib/scim';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const baseUrl = request.nextUrl.origin;

  const resourceTypes: Record<string, object> = {
    User: {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      description: 'OpsKnight User Account',
      schema: SCIM_USER_SCHEMA,
      meta: {
        resourceType: 'ResourceType',
        location: `${baseUrl}/api/scim/v2/ResourceTypes/User`,
      },
    },
    Group: {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      description: 'OpsKnight Team Group',
      schema: SCIM_GROUP_SCHEMA,
      meta: {
        resourceType: 'ResourceType',
        location: `${baseUrl}/api/scim/v2/ResourceTypes/Group`,
      },
    },
  };

  if (id !== 'User' && id !== 'Group') {
    return scimError(404, `ResourceType '${id}' not found.`);
  }

  const matched = id === 'User' ? resourceTypes.User : resourceTypes.Group;

  return Response.json(matched, {
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
