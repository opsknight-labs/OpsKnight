import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertResponderOrAbove } from '@/lib/rbac';
import { buildCsv, type CsvColumn } from '@/lib/csv';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await assertResponderOrAbove();
  } catch (_error) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams, origin } = new URL(req.url);

  // Validate and sanitize input parameters to prevent abuse
  const VALID_FILTERS = [
    'all',
    'mine',
    'all_open',
    'open',
    'acknowledged',
    'resolved',
    'snoozed',
    'suppressed',
  ];
  const VALID_FORMATS = ['csv', 'xlsx'];
  const VALID_URGENCIES = ['all', 'HIGH', 'MEDIUM', 'LOW'];
  const VALID_PRIORITIES = ['all', 'P1', 'P2', 'P3', 'P4', 'P5'];

  const filterParam = searchParams.get('filter') || 'all';
  const filter = VALID_FILTERS.includes(filterParam) ? filterParam : 'all';

  // Limit search string length to prevent abuse
  const search = (searchParams.get('search') || '').slice(0, 200);

  const priorityParam = searchParams.get('priority') || 'all';
  const priority = VALID_PRIORITIES.includes(priorityParam) ? priorityParam : 'all';

  const urgencyParam = searchParams.get('urgency') || 'all';
  const urgency = VALID_URGENCIES.includes(urgencyParam) ? urgencyParam : 'all';

  const teamId = searchParams.get('teamId') || 'all';

  const formatParam = searchParams.get('format') || 'csv';
  const format = VALID_FORMATS.includes(formatParam) ? formatParam : 'csv';

  let where: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (filter === 'mine') {
    where = {
      assigneeId: (session.user as any).id, // eslint-disable-line @typescript-eslint/no-explicit-any
      status: { notIn: ['RESOLVED', 'SNOOZED', 'SUPPRESSED'] },
    };
  } else if (filter === 'all_open') {
    where = { status: { notIn: ['RESOLVED', 'SNOOZED', 'SUPPRESSED'] } };
  } else if (filter === 'open') {
    where = { status: 'OPEN' };
  } else if (filter === 'acknowledged') {
    where = { status: 'ACKNOWLEDGED' };
  } else if (filter === 'resolved') {
    where = { status: 'RESOLVED' };
  } else if (filter === 'snoozed') {
    where = { status: 'SNOOZED' };
  } else if (filter === 'suppressed') {
    where = { status: 'SUPPRESSED' };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { id: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (priority !== 'all') {
    where.priority = priority;
  }

  if (urgency !== 'all') {
    where.urgency = urgency;
  }

  if (teamId !== 'all') {
    if (teamId === 'mine') {
      const userId = (session.user as { id?: string }).id;
      if (userId) {
        const memberships = await prisma.teamMember.findMany({
          where: { userId },
          select: { teamId: true },
        });
        where.teamId = { in: memberships.map(m => m.teamId) };
      }
    } else {
      where.teamId = teamId;
    }
  }

  // Limit export to 10,000 incidents to prevent memory exhaustion
  // For larger exports, use pagination or streaming
  const MAX_EXPORT_LIMIT = 10000;
  const incidents = await prisma.incident.findMany({
    where,
    include: {
      service: true,
      assignee: true,
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_EXPORT_LIMIT,
  });

  const formatUtc = (date: Date | null) => {
    if (!date) return '';
    const iso = date.toISOString();
    return iso.replace('T', ' ').replace('Z', ' UTC');
  };

  const statusMeta: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Open', color: '#DC2626' },
    ACKNOWLEDGED: { label: 'Acknowledged', color: '#D97706' },
    RESOLVED: { label: 'Resolved', color: '#059669' },
    SNOOZED: { label: 'Snoozed', color: '#64748B' },
    SUPPRESSED: { label: 'Suppressed', color: '#475569' },
  };

  const priorityMeta: Record<string, { label: string; color: string }> = {
    P1: { label: 'P1 - Critical', color: '#B91C1C' },
    P2: { label: 'P2 - High', color: '#D97706' },
    P3: { label: 'P3 - Medium', color: '#CA8A04' },
    P4: { label: 'P4 - Low', color: '#2563EB' },
    P5: { label: 'P5 - Info', color: '#64748B' },
  };

  const urgencyMeta: Record<string, { label: string; color: string }> = {
    HIGH: { label: 'High', color: '#DC2626' },
    MEDIUM: { label: 'Medium', color: '#D97706' },
    LOW: { label: 'Low', color: '#059669' },
  };

  // Convert to CSV
  const rows = incidents.map(incident => ({
    id: incident.id,
    incidentUrl: `${origin}/incidents/${incident.id}`,
    title: incident.title,
    description: incident.description || '',
    status: incident.status,
    statusLabel: statusMeta[incident.status]?.label || incident.status,
    statusColor: statusMeta[incident.status]?.color || '',
    priority: incident.priority || '',
    priorityLabel: incident.priority
      ? priorityMeta[incident.priority]?.label || incident.priority
      : '',
    priorityColor: incident.priority ? priorityMeta[incident.priority]?.color || '' : '',
    urgency: incident.urgency || '',
    urgencyLabel: incident.urgency ? urgencyMeta[incident.urgency]?.label || incident.urgency : '',
    urgencyColor: incident.urgency ? urgencyMeta[incident.urgency]?.color || '' : '',
    service: incident.service.name,
    serviceUrl: `${origin}/services/${incident.service.id}`,
    assignee: incident.assignee?.name || 'Unassigned',
    assigneeEmail: incident.assignee?.email || '',
    createdAtUtc: formatUtc(incident.createdAt),
    updatedAtUtc: formatUtc(incident.updatedAt),
    resolvedAtUtc: formatUtc(incident.resolvedAt ?? null),
    createdAtIso: incident.createdAt.toISOString(),
    updatedAtIso: incident.updatedAt.toISOString(),
    resolvedAtIso: incident.resolvedAt?.toISOString() || '',
  }));

  type ExportRow = (typeof rows)[number];
  const columns: CsvColumn<ExportRow>[] = [
    { key: 'id', header: 'ID' },
    { key: 'incidentUrl', header: 'Incident URL' },
    { key: 'title', header: 'Title' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status' },
    { key: 'statusLabel', header: 'Status Label' },
    { key: 'statusColor', header: 'Status Color' },
    { key: 'priority', header: 'Priority' },
    { key: 'priorityLabel', header: 'Priority Label' },
    { key: 'priorityColor', header: 'Priority Color' },
    { key: 'urgency', header: 'Urgency' },
    { key: 'urgencyLabel', header: 'Urgency Label' },
    { key: 'urgencyColor', header: 'Urgency Color' },
    { key: 'service', header: 'Service' },
    { key: 'serviceUrl', header: 'Service URL' },
    { key: 'assignee', header: 'Assignee' },
    { key: 'assigneeEmail', header: 'Assignee Email' },
    { key: 'createdAtUtc', header: 'Created At (UTC)' },
    { key: 'updatedAtUtc', header: 'Updated At (UTC)' },
    { key: 'resolvedAtUtc', header: 'Resolved At (UTC)' },
    { key: 'createdAtIso', header: 'Created At (ISO)' },
    { key: 'updatedAtIso', header: 'Updated At (ISO)' },
    { key: 'resolvedAtIso', header: 'Resolved At (ISO)' },
  ];

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OpsKnight';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Incidents', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = columns.map(column => ({
      header: column.header,
      key: column.key as string,
      width: Math.max(14, column.header.length + 2),
      style: { alignment: { vertical: 'middle', wrapText: true } },
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle' };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    headerRow.height = 22;

    rows.forEach(row => {
      sheet.addRow(row);
    });

    const statusColorIndex = columns.findIndex(col => col.key === 'statusColor') + 1;
    const priorityColorIndex = columns.findIndex(col => col.key === 'priorityColor') + 1;
    const urgencyColorIndex = columns.findIndex(col => col.key === 'urgencyColor') + 1;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      [statusColorIndex, priorityColorIndex, urgencyColorIndex].forEach(index => {
        const cell = row.getCell(index);
        const color = typeof cell.value === 'string' ? cell.value : '';
        if (!color) return;
        const argb = `FF${color.replace('#', '').toUpperCase()}`;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
        cell.font = { color: { argb: 'FFFFFFFF' } };
      });
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const filename = `incidents-${new Date().toISOString().split('T')[0]}.xlsx`;
    const response = new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
    return response;
  }

  const csv = buildCsv(rows, columns);

  const csvFilename = `incidents-${new Date().toISOString().split('T')[0]}.csv`;
  const response = new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename}"`,
      'Cache-Control': 'no-store',
    },
  });
  return response;
}
