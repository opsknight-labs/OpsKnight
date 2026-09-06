import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-config';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const statusPages = await prisma.statusPage.findMany({
      where: { enabled: true },
      select: {
        id: true,
        slug: true,
        isDefault: true,
        enabled: true,
        subdomain: true,
        customDomain: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
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
      enabled: statusPages.length > 0,
      pages: statusPages,
      appHost,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({
      enabled: false,
      pages: [],
      appHost: null,
    });
  }
}
