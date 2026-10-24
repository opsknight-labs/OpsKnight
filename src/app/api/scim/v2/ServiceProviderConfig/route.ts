import { NextRequest } from 'next/server';
import { getServiceProviderConfig } from '@/lib/scim';
import { resolveScimPublicOrigin } from '@/lib/scim/protocol/origin';
import { handle } from '@/lib/scim/protocol/http';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const baseUrl = await resolveScimPublicOrigin();
    const config = getServiceProviderConfig(baseUrl);

    return Response.json(config, {
      headers: {
        'Content-Type': 'application/scim+json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }, request);
}
