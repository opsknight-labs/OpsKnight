import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-config';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const statusPage = await prisma.statusPage.findFirst({
      select: {
        enabled: true,
        subdomain: true,
        customDomain: true,
      },
    });

    const appUrl = await getAppUrl();
    const appHost = (() => {
      try {
        return new URL(appUrl).host;
      } catch {
        return null;
      }
    })();

    const response = NextResponse.json({
      enabled: Boolean(statusPage?.enabled),
      subdomain: statusPage?.subdomain ?? null,
      customDomain: statusPage?.customDomain ?? null,
      appHost,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({
      enabled: false,
      subdomain: null,
      customDomain: null,
      appHost: null,
    });
  }
}
