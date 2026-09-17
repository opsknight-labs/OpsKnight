import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-config';
import { createStatusAuthTicket } from '@/lib/status-pages/status-auth';

export const dynamic = 'force-dynamic';

function normalizeHost(value?: string | null): string {
  if (!value) return '';
  return value.trim().toLowerCase().split(':')[0] ?? '';
}

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

  const targetHost = normalizeHost(targetUrl.host);
  const appHost = normalizeHost(new URL(appUrl).host);
  const customHost = normalizeHost(statusPage.customDomain);
  const subHost = statusPage.subdomain ? normalizeHost(`${statusPage.subdomain}.${appHost}`) : '';

  const isAllowedHost =
    targetHost === appHost ||
    targetHost === 'localhost' ||
    targetHost === '127.0.0.1' ||
    (customHost && targetHost === customHost) ||
    (subHost && targetHost === subHost);

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
