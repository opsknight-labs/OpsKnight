import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { completeOidcRevisionTest, OIDC_TEST_COOKIE } from '@/lib/auth-control/oidc-revisions';
import { authenticationOrigin } from '@/lib/auth-control/origin';

export async function GET(request: NextRequest) {
  const destination = new URL('/auth/oidc-test-result', await authenticationOrigin());
  try {
    const query = z
      .object({ code: z.string().min(1).max(4096), state: z.string().min(32).max(128) })
      .parse({
        code: request.nextUrl.searchParams.get('code'),
        state: request.nextUrl.searchParams.get('state'),
      });
    const revisionId = await completeOidcRevisionTest(
      query.state,
      query.code,
      request.cookies.get(OIDC_TEST_COOKIE)?.value ?? ''
    );
    destination.searchParams.set('outcome', 'verified');
    if (revisionId) {
      destination.searchParams.set('revisionId', revisionId);
    }
  } catch {
    destination.searchParams.set('outcome', 'failed');
  }
  const response = NextResponse.redirect(destination, 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.delete(OIDC_TEST_COOKIE);
  return response;
}
