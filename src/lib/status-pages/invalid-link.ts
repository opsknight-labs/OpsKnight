import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/app-config';
import { isRequestToAppHost } from '@/lib/status-pages/status-auth';

/**
 * Where a confirm or unsubscribe form lands when its link is invalid or expired: the page that says
 * so. A custom domain serves only the status paths, and `/status` is not one of them, so the old
 * redirect to `/status` ended at a bare 404 there.
 */
export async function invalidLinkRedirect(
  req: NextRequest,
  kind: 'verify' | 'unsubscribe',
  token: string
) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const onAppHost = isRequestToAppHost(host, await getAppUrl());
  const usable = token.length > 0 && token.length <= 256;
  const path = usable
    ? `${onAppHost ? '/status' : ''}/${kind}/${encodeURIComponent(token)}`
    : onAppHost
      ? '/status'
      : '/';
  return NextResponse.redirect(new URL(path, req.url), 303);
}
