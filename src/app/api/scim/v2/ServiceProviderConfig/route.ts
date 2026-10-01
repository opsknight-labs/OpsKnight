import { NextRequest } from 'next/server';
import { getServiceProviderConfig } from '@/lib/scim';

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;
  const config = getServiceProviderConfig(baseUrl);

  return Response.json(config, {
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
