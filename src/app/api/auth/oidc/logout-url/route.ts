import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { z } from 'zod';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { SESSION_TOKEN_COOKIE_NAME, useSecureCookies } from '@/lib/auth-cookies';
import { customJwtDecode } from '@/lib/auth-jwt-encoder';
import { getOidcConfig } from '@/lib/oidc-config';
import { getValidatedOidcRuntimeMetadata } from '@/lib/oidc-validation';
import { getNextAuthSecret } from '@/lib/secret-manager';
import { jsonError, jsonOk } from '@/lib/api-response';

const QuerySchema = z.object({ callbackUrl: z.string().max(2048).optional() });
const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: NextRequest) {
  const query = QuerySchema.safeParse({
    callbackUrl: request.nextUrl.searchParams.get('callbackUrl') ?? undefined,
  });
  if (!query.success) {
    return jsonError('Invalid callback URL.', 400, undefined, noStoreHeaders);
  }

  const token = await getToken({
    req: request,
    secret: await getNextAuthSecret(),
    cookieName: SESSION_TOKEN_COOKIE_NAME,
    secureCookie: useSecureCookies,
    decode: customJwtDecode,
  });
  if (token?.authProvider !== 'oidc') {
    return jsonOk({ url: null }, 200, noStoreHeaders);
  }

  const config = await getOidcConfig();
  if (!config) return jsonOk({ url: null }, 200, noStoreHeaders);

  const validation = await getValidatedOidcRuntimeMetadata(config.issuer, {
    tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
  });
  const endpoint = validation.metadata?.endSessionEndpoint;
  if (!endpoint) return jsonOk({ url: null }, 200, noStoreHeaders);

  const callbackPath = safeInternalCallbackUrl(query.data.callbackUrl, '/login');
  const logoutUrl = new URL(endpoint);
  logoutUrl.searchParams.set('client_id', config.clientId);
  logoutUrl.searchParams.set(
    'post_logout_redirect_uri',
    new URL(callbackPath, request.nextUrl.origin).toString()
  );

  return jsonOk({ url: logoutUrl.toString() }, 200, noStoreHeaders);
}
