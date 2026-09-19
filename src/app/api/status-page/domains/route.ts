import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-config';
import { NextResponse } from 'next/server';
import { verifyStatusDomainRequest } from '@/lib/status-pages/internal-request';

export async function GET(request: Request) {
  if (!(await verifyStatusDomainRequest(request.headers))) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
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
        requireAuth: true,
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
      appUrl,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'Routing configuration unavailable' }, { status: 503 });
  }
}
