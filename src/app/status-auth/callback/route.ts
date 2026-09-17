import { NextResponse, type NextRequest } from 'next/server';
import { resolveStatusPage } from '@/lib/status-page-resolver';
import {
  STATUS_SESSION_COOKIE_NAME,
  createStatusSessionToken,
  verifyStatusAuthTicket,
} from '@/lib/status-pages/status-auth';
import { useSecureCookies } from '@/lib/auth-cookies';

import { normalizeHostname } from '@/lib/status-pages/status-route-resolver';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ticket = searchParams.get('ticket')?.trim();
  const rawReturnTo = searchParams.get('returnTo')?.trim() || '/';

  if (!ticket) {
    return new NextResponse('Missing ticket parameter', { status: 400 });
  }

  const host =
    req.headers
      .get('x-forwarded-host')
      ?.split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .at(-1) ||
    req.headers.get('host') ||
    '';

  const cleanHost = normalizeHostname(host);
  const statusPage = await resolveStatusPage({ host: cleanHost });

  if (!statusPage) {
    return new NextResponse('Status page not found for host', { status: 404 });
  }

  const ticketPayload = await verifyStatusAuthTicket(ticket, statusPage.id, cleanHost);
  if (!ticketPayload) {
    return new NextResponse('Invalid or expired status authentication ticket', { status: 401 });
  }

  // Ensure returnTo is a relative path to prevent open redirect
  let safeReturnTo = '/';
  if (rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')) {
    safeReturnTo = rawReturnTo;
  } else {
    try {
      const parsed = new URL(rawReturnTo);
      if (parsed.host.toLowerCase().split(':')[0] === cleanHost) {
        safeReturnTo = parsed.pathname + parsed.search;
      }
    } catch {
      safeReturnTo = '/';
    }
  }

  const sessionToken = await createStatusSessionToken(statusPage.id, ticketPayload.userId);
  const redirectUrl = new URL(safeReturnTo, req.nextUrl.origin);
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set({
    name: STATUS_SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60, // 24 hours
  });

  return response;
}
