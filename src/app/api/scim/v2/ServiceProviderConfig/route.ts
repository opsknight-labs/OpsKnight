import { NextRequest } from 'next/server';
import { getServiceProviderConfig } from '@/lib/scim';
import { resolveScimPublicOrigin } from '@/lib/scim/protocol/origin';

export async function GET(_request: NextRequest) {
  const baseUrl = await resolveScimPublicOrigin();
  const config = getServiceProviderConfig(baseUrl);

  return Response.json(config, {
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
