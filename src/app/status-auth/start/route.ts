import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-config';
import { createStatusAuthTicket } from '@/lib/status-pages/status-auth';
import {
  normalizeHostname,
  matchesStatusPageDomain,
} from '@/lib/status-pages/status-route-resolver';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pageId = searchParams.get('pageId')?.trim();
  const returnTo = searchParams.get('returnTo')?.trim() || '/';

  if (!pageId) {
    return new NextResponse('Missing pageId parameter', { status: 400 });
  }

  const appUrl = await getAppUrl();
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    const loginUrl = new URL(`${appUrl}/login`);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const statusPage = await prisma.statusPage.findFirst({
    where: { id: pageId, enabled: true },
    select: { id: true, slug: true, customDomain: true, subdomain: true, isDefault: true },
  });

  if (!statusPage) {
    return new NextResponse('Status page not found', { status: 404 });
  }

  // Validate returnTo target host against registered domains
  let targetUrl: URL;
  try {
    targetUrl = new URL(returnTo, appUrl);
  } catch {
    return new NextResponse('Invalid returnTo URL', { status: 400 });
  }

  const targetHost = normalizeHostname(targetUrl.host);
  const appHost = normalizeHostname(new URL(appUrl).host);

  const isAllowedHost =
    targetHost === appHost ||
    targetHost === 'localhost' ||
    targetHost === '127.0.0.1' ||
    targetHost.endsWith('.localhost') ||
    matchesStatusPageDomain(statusPage, targetHost, appHost);

  if (!isAllowedHost) {
    return new NextResponse('Untrusted returnTo host for this status page', { status: 400 });
  }

  const userId = (session.user as { id?: string })?.id;
  const ticket = await createStatusAuthTicket({
    pageId: statusPage.id,
    targetHost,
    returnTo: targetUrl.pathname + targetUrl.search,
    userId,
  });

  const callbackUrl = new URL(`${targetUrl.origin}/status-auth/callback`);
  callbackUrl.searchParams.set('ticket', ticket);
  callbackUrl.searchParams.set('returnTo', targetUrl.pathname + targetUrl.search);

  return NextResponse.redirect(callbackUrl);
}
