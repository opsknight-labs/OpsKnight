import { NextRequest } from 'next/server';
import { SCIM_SCHEMA_SCHEMA, SCIM_USER_SCHEMA, SCIM_GROUP_SCHEMA, scimError } from '@/lib/scim';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const decodedId = decodeURIComponent(id);
  const baseUrl = request.nextUrl.origin;

  const schemas: Record<string, object> = {
    [SCIM_USER_SCHEMA]: {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description: 'OpsKnight User Account Schema',
      meta: {
        resourceType: 'Schema',
        location: `${baseUrl}/api/scim/v2/Schemas/${encodeURIComponent(SCIM_USER_SCHEMA)}`,
      },
    },
    [SCIM_GROUP_SCHEMA]: {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_GROUP_SCHEMA,
      name: 'Group',
      description: 'OpsKnight Group Schema',
      meta: {
        resourceType: 'Schema',
        location: `${baseUrl}/api/scim/v2/Schemas/${encodeURIComponent(SCIM_GROUP_SCHEMA)}`,
      },
    },
  };

  const matched = schemas[decodedId];
  if (!matched) {
    return scimError(404, `Schema '${decodedId}' not found.`);
  }

  return Response.json(matched, {
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
