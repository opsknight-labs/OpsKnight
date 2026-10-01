import { NextRequest } from 'next/server';
import { getScimSchemas, scimError } from '@/lib/scim';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const decodedId = decodeURIComponent(id);
  const baseUrl = request.nextUrl.origin;

  const schemas = getScimSchemas(baseUrl);
  const matched = schemas.find(s => s.id === decodedId);
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
