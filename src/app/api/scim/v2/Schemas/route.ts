import { NextRequest } from 'next/server';
import {
  SCIM_LIST_SCHEMA,
  SCIM_SCHEMA_SCHEMA,
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
} from '@/lib/scim';

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;

  const schemas = [
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description: 'OpsKnight User Account Schema',
      meta: {
        resourceType: 'Schema',
        location: `${baseUrl}/api/scim/v2/Schemas/${encodeURIComponent(SCIM_USER_SCHEMA)}`,
      },
    },
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_GROUP_SCHEMA,
      name: 'Group',
      description: 'OpsKnight Group Schema',
      meta: {
        resourceType: 'Schema',
        location: `${baseUrl}/api/scim/v2/Schemas/${encodeURIComponent(SCIM_GROUP_SCHEMA)}`,
      },
    },
  ];

  return Response.json(
    {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: schemas.length,
      startIndex: 1,
      itemsPerPage: schemas.length,
      Resources: schemas,
    },
    {
      headers: {
        'Content-Type': 'application/scim+json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}
