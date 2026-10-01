import { NextRequest } from 'next/server';
import { SCIM_LIST_SCHEMA, getScimSchemas } from '@/lib/scim';

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;
  const schemas = getScimSchemas(baseUrl);

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
