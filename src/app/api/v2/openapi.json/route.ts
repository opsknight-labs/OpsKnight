import { NextRequest, NextResponse } from 'next/server';
import { getOpenApiV2Spec } from '@/lib/api-v2';

/**
 * Discovery document. Returned as the bare OpenAPI object (not the `{ data, requestId }`
 * business envelope) so validators, SDK generators and documentation tools can consume the
 * URL directly: `openapi`, `info` and `paths` must sit at the document root.
 */
export async function GET(_req: NextRequest) {
  return NextResponse.json(getOpenApiV2Spec(), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
