import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { buildCsv } from '@/lib/csv';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';

function escapePdf(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines: string[]): Buffer {
  const PAGE_HEIGHT = 792;
  const TOP_MARGIN = 750;
  const LINE_HEIGHT = 16;
  const LINES_PER_PAGE = Math.max(1, Math.floor((TOP_MARGIN - 50) / LINE_HEIGHT));

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(['']);

  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  let nextObjId = 4; // 1=Catalog, 2=Pages, 3=Font

  pages.forEach(() => {
    pageObjectIds.push(nextObjId++);
    contentObjectIds.push(nextObjId++);
  });

  const objects: { id: number; data: string }[] = [];
  objects.push({ id: 1, data: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({
    id: 2,
    data: `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  });
  objects.push({ id: 3, data: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });

  pages.forEach((pageLines, idx) => {
    const pageObjId = pageObjectIds[idx];
    const contentObjId = contentObjectIds[idx];

    objects.push({
      id: pageObjId,
      data: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    });

    const streamContent = pageLines
      .map((line, lineIdx) => {
        const y = TOP_MARGIN - lineIdx * LINE_HEIGHT;
        return `BT /F1 11 50 ${y} Td (${escapePdf(line)}) Tj ET`;
      })
      .join('\n');

    const byteLen = Buffer.byteLength(streamContent, 'utf8');
    objects.push({
      id: contentObjId,
      data: `<< /Length ${byteLen} >>\nstream\n${streamContent}\nendstream`,
    });
  });

  // Sort objects by ID for standard xref order
  objects.sort((a, b) => a.id - b.id);

  let body = '%PDF-1.4\n';
  const xrefOffsets: number[] = [];

  objects.forEach(obj => {
    xrefOffsets.push(Buffer.byteLength(body, 'utf8'));
    body += `${obj.id} 0 obj\n${obj.data}\nendobj\n`;
  });

  const startXref = Buffer.byteLength(body, 'utf8');
  let xrefTable = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  xrefOffsets.forEach(off => {
    xrefTable += `${off.toString().padStart(10, '0')} 00000 n \n`;
  });

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;
  return Buffer.from(body + xrefTable + trailer, 'utf8');
}

export async function GET(req: NextRequest) {
  let isAdmin = false;
  try {
    await assertAdmin();
    isAdmin = true;
  } catch (_error) {
    isAdmin = false;
  }

  if (!isAdmin) {
    const publicPage = await prisma.statusPage.findFirst({
      where: { enabled: true, enableUptimeExports: true },
      select: { requireAuth: true },
    });
    if (!publicPage) {
      return new NextResponse('Unauthorized', { status: 403 });
    }
    if (publicPage.requireAuth) {
      const session = await getServerSession(await getAuthOptions());
      if (!session) {
        return new NextResponse('Authentication required', {
          status: 401,
          headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
        });
      }
    }
  }

  try {
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const monthParam = searchParams.get('month');
    const monthMatch = monthParam?.match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    let year = monthMatch ? Number(monthMatch[1]) : now.getUTCFullYear();
    let monthIndex = monthMatch ? Number(monthMatch[2]) - 1 : now.getUTCMonth();

    if (isNaN(year) || year < 2000 || year > 2100) {
      year = now.getUTCFullYear();
    }
    if (isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      monthIndex = now.getUTCMonth();
    }

    const periodStart = new Date(Date.UTC(year, monthIndex, 1));
    const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

    const statusPage = await prisma.statusPage.findFirst({
      where: { enabled: true },
      include: {
        services: {
          include: { service: true },
          where: { showOnPage: true },
        },
      },
    });

    if (!statusPage) {
      return new NextResponse('Status page not found', { status: 404 });
    }

    if (!statusPage.enableUptimeExports) {
      return new NextResponse('Uptime exports are disabled', { status: 403 });
    }

    const serviceIds = statusPage.services.map(sp => sp.serviceId);
    if (serviceIds.length === 0) {
      return new NextResponse('No services configured', { status: 400 });
    }

    const { calculateMultiServiceUptime } = await import('@/lib/sla-server');
    const uptimeMap = await calculateMultiServiceUptime(serviceIds, periodStart, periodEnd);

    const uptimeRows = statusPage.services.map(sp => {
      return {
        id: sp.service.id,
        name: sp.displayName || sp.service.name,
        uptime: Math.max(0, Math.min(100, uptimeMap[sp.service.id] || 100)),
      };
    });

    if (format === 'pdf') {
      const lines = [
        `${statusPage.name} - Monthly Uptime Report`,
        `Period: ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
        '',
        ...uptimeRows.map(row => `${row.name}: ${row.uptime.toFixed(3)}%`),
      ];
      const pdf = buildSimplePdf(lines);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="uptime-${year}-${String(monthIndex + 1).padStart(2, '0')}.pdf"`,
        },
      });
    }

    const csvData = uptimeRows.map(row => ({
      serviceId: row.id,
      serviceName: row.name,
      uptimePercentage: row.uptime.toFixed(3),
    }));

    const csv = buildCsv(csvData, [
      { key: 'serviceId', header: 'Service ID' },
      { key: 'serviceName', header: 'Service Name' },
      { key: 'uptimePercentage', header: 'Uptime %' },
    ]);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="uptime-${year}-${String(monthIndex + 1).padStart(2, '0')}.csv"`,
      },
    });
  } catch (error: any) {
    logger.error('api.status.uptime_export_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse('Failed to export uptime report', { status: 500 });
  }
}
