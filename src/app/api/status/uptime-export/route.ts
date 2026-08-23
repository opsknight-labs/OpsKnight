import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { buildCsv } from '@/lib/csv';

function escapePdf(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines: string[]) {
  const contentLines = lines
    .map((line, index) => {
      const y = 760 - index * 16;
      return `BT /F1 12 50 ${y} Td (${escapePdf(line)}) Tj ET`;
    })
    .join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj'
  );
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  objects.push(
    `5 0 obj\n<< /Length ${contentLines.length} >>\nstream\n${contentLines}\nendstream\nendobj`
  );

  let offset = 0;
  const xref: number[] = [];
  let body = '%PDF-1.4\n';
  objects.forEach(obj => {
    xref.push(offset);
    body += obj + '\n';
    offset = Buffer.byteLength(body, 'utf8');
  });

  const xrefStart = offset;
  let xrefTable = 'xref\n0 6\n0000000000 65535 f \n';
  xref.forEach(off => {
    xrefTable += `${off.toString().padStart(10, '0')} 00000 n \n`;
  });

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body + xrefTable + trailer, 'utf8');
}

export async function GET(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (_error) {
    return new NextResponse('Unauthorized', { status: 403 });
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
      return new NextResponse(pdf, {
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
