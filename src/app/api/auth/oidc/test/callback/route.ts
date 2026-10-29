import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v3';
import {
  completeOidcRevisionTest,
  OIDC_TEST_COOKIE,
  OIDC_TEST_RESULT_COOKIE,
  OidcRevisionTestError,
} from '@/lib/auth-control/oidc-revisions';
import { authenticationOrigin } from '@/lib/auth-control/origin';
import { emergencyCookieOptions } from '@/lib/auth-control/emergency';

export async function GET(request: NextRequest) {
  // The result page reads recorded evidence through an opaque, browser-bound reference.
  // Nothing in the redirect URL can make it display a successful verification.
  const destination = new URL('/auth/oidc-test-result', await authenticationOrigin());
  const browserToken = request.cookies.get(OIDC_TEST_COOKIE)?.value ?? '';
  let flowId: string | null = null;
  try {
    const query = z
      .object({ code: z.string().min(1).max(4096), state: z.string().min(32).max(128) })
      .parse({
        code: request.nextUrl.searchParams.get('code'),
        state: request.nextUrl.searchParams.get('state'),
      });
    flowId = (await completeOidcRevisionTest(query.state, query.code, browserToken)).flowId;
  } catch (error) {
    flowId = error instanceof OidcRevisionTestError ? error.flowId : null;
  }
  const response = NextResponse.redirect(destination, 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.delete(OIDC_TEST_COOKIE);
  if (flowId && browserToken) {
    response.cookies.set(OIDC_TEST_RESULT_COOKIE, `${flowId}.${browserToken}`, {
      ...emergencyCookieOptions,
      // Lax so the cookie survives the top-level redirect back from the identity provider.
      sameSite: 'lax',
      maxAge: 15 * 60,
    });
  } else {
    response.cookies.delete(OIDC_TEST_RESULT_COOKIE);
  }
  return response;
}
