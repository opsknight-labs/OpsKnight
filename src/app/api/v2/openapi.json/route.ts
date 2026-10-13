import { NextRequest } from 'next/server';
import { apiV2Success, getOpenApiV2Spec } from '@/lib/api-v2';

export async function GET(_req: NextRequest) {
  const spec = getOpenApiV2Spec();
  return apiV2Success(spec, {
    headers: {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
