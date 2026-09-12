import { buildCsv } from '@/lib/csv';

export interface StatusPageReportService {
  id: string;
  name: string;
  region?: string | null;
  description?: string | null;
  uptime: number; // percentage 0 - 100
  slaTarget: number; // percentage e.g. 99.9
  downtimeMinutes: number;
}

export interface StatusPageReportIncident {
  id: string;
  title: string;
  serviceName?: string | null;
  startedAt: Date;
  resolvedAt?: Date | null;
  durationMinutes: number;
  status: string;
}

export interface StatusPageReportData {
  pageId: string;
  pageName: string;
  organizationName: string;
  url?: string | null;
  primaryColor?: string | null;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  uptimeExcellentThreshold: number;
  uptimeGoodThreshold: number;
  visibility: {
    showServices: boolean;
    showServiceRegion: boolean;
    showServiceDescription?: boolean;
    showIncidents: boolean;
    showIncidentTitle: boolean;
    showIncidentDescription: boolean;
    showAffectedService: boolean;
    showIncidentTimestamp: boolean;
  };
  services: StatusPageReportService[];
  incidents: StatusPageReportIncident[];
  overallAvailability: number;
  slaComplianceRate: number;
}

/**
 * Parses hex color strings (#RGB or #RRGGBB) to normalized RGB floats [0..1]
 */
function hexToRgb(hex: string | null | undefined): [number, number, number] {
  if (!hex) return [0.145, 0.388, 0.922]; // Default OpsKnight Brand Blue (#2563eb)
  let c = hex.replace('#', '').trim();
  if (c.length === 3) {
    c = c
      .split('')
      .map(x => x + x)
      .join('');
  }
  if (c.length !== 6) return [0.145, 0.388, 0.922];
  const num = parseInt(c, 16);
  if (isNaN(num)) return [0.145, 0.388, 0.922];
  return [
    Math.min(1, Math.max(0, (num >> 16) / 255)),
    Math.min(1, Math.max(0, ((num >> 8) & 255) / 255)),
    Math.min(1, Math.max(0, (num & 255) / 255)),
  ];
}

/**
 * Escapes characters for PDF text operators
 */
function escapePdf(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' '); // Map non-printable ASCII to space
}

/**
 * Format minutes into friendly downtime string (e.g. 0m, 4m 12s, 2h 15m)
 */
function formatDowntimeDuration(minutes: number): string {
  if (!minutes || minutes <= 0.01) return '0m';
  if (minutes < 1) {
    const secs = Math.round(minutes * 60);
    return `${secs}s`;
  }
  if (minutes < 60) {
    const mins = Math.floor(minutes);
    const secs = Math.round((minutes - mins) * 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = Math.round(minutes % 60);
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Builds an enhanced, branded CSV export respecting all public boundaries
 */
export function buildEnhancedUptimeCsv(data: StatusPageReportData): string {
  const lines: string[] = [];

  const safeComment = (str: string | null | undefined) =>
    (str || '').replace(/[\r\n]+/g, ' ').trim();

  // 1. Executive Metadata Comment Block
  lines.push('# ==============================================================================');
  lines.push('# OPSKNIGHT STATUS PAGE AVAILABILITY & SLA AUDIT REPORT');
  lines.push('# ==============================================================================');
  lines.push(`# Organization: ${safeComment(data.organizationName || data.pageName)}`);
  lines.push(`# Status Page: ${safeComment(data.pageName)}`);
  if (data.url) {
    lines.push(`# Status Page URL: ${safeComment(data.url)}`);
  }
  lines.push(
    `# Reporting Period: ${data.periodStart.toISOString().slice(0, 10)} to ${data.periodEnd.toISOString().slice(0, 10)} (UTC)`
  );
  lines.push(`# Generated At: ${data.generatedAt.toISOString()} (UTC)`);
  lines.push(`# Target SLA Threshold: ${data.uptimeExcellentThreshold.toFixed(3)}%`);
  lines.push(`# Overall System Availability: ${data.overallAvailability.toFixed(3)}%`);
  lines.push(`# SLA Compliance Rate: ${data.slaComplianceRate.toFixed(1)}%`);
  if (data.visibility.showServices) {
    lines.push(`# Total Public Services: ${data.services.length}`);
  } else {
    lines.push('# Public Services: Hidden by Status Page Privacy Settings');
  }
  lines.push('# Public Boundary: Strict (Verified Zero Internal Responder Data)');
  lines.push('# ==============================================================================');
  lines.push('');

  // 2. Services Data Table (or privacy notice if services hidden)
  if (data.visibility.showServices) {
    const serviceColumns: { key: string; header: string }[] = [
      { key: 'serviceName', header: 'Service Name' },
    ];
    if (data.visibility.showServiceRegion) {
      serviceColumns.push({ key: 'region', header: 'Region' });
    }
    if (data.visibility.showServiceDescription) {
      serviceColumns.push({ key: 'description', header: 'Description' });
    }
    serviceColumns.push(
      { key: 'slaTarget', header: 'SLA Target %' },
      { key: 'uptimePercentage', header: 'Actual Availability %' },
      { key: 'downtimeMinutes', header: 'Estimated Downtime (Minutes)' },
      { key: 'downtimeFormatted', header: 'Downtime Duration' },
      { key: 'complianceStatus', header: 'Compliance Status' }
    );

    const serviceRows = data.services.map(s => {
      const isMet = s.uptime >= s.slaTarget;
      const row: Record<string, string | number> = {
        serviceName: s.name,
        slaTarget: s.slaTarget.toFixed(3),
        uptimePercentage: s.uptime.toFixed(3),
        downtimeMinutes: Number(s.downtimeMinutes.toFixed(2)),
        downtimeFormatted: formatDowntimeDuration(s.downtimeMinutes),
        complianceStatus: isMet ? 'MET' : 'BELOW_TARGET',
      };
      if (data.visibility.showServiceRegion) {
        row.region = s.region || 'Global / Default';
      }
      if (data.visibility.showServiceDescription) {
        row.description = s.description || '';
      }
      return row;
    });

    const servicesCsv = buildCsv(serviceRows, serviceColumns as any);
    // Strip BOM if present since we append to our header
    lines.push(servicesCsv.replace(/^\uFEFF/, ''));
  } else {
    lines.push('# ==============================================================================');
    lines.push('# SERVICE BREAKDOWN');
    lines.push('# ==============================================================================');
    lines.push('# Individual service breakdown is restricted by status page privacy policy.');
    lines.push('# Overall system availability remains audited and verified above.');
  }

  // 3. Public Incident Summary (if enabled)
  if (data.visibility.showIncidents) {
    lines.push('');
    lines.push('# ==============================================================================');
    lines.push('# PUBLIC INCIDENT LOG (REPORTING PERIOD)');
    lines.push('# ==============================================================================');

    if (data.incidents.length === 0) {
      lines.push('# No service-impacting public incidents were recorded during this period.');
    } else {
      const showAffectedService =
        data.visibility.showServices && data.visibility.showAffectedService;
      const incidentColumns: { key: string; header: string }[] = [
        { key: 'title', header: 'Incident Title' },
      ];
      if (showAffectedService) {
        incidentColumns.push({ key: 'service', header: 'Impacted Service' });
      }
      if (data.visibility.showIncidentTimestamp) {
        incidentColumns.push(
          { key: 'startedAt', header: 'Started At (UTC)' },
          { key: 'resolvedAt', header: 'Resolved At (UTC)' },
          { key: 'durationMinutes', header: 'Duration (Minutes)' }
        );
      }
      incidentColumns.push({ key: 'status', header: 'Status' });

      const incidentRows = data.incidents.map(inc => {
        const row: Record<string, string | number> = {
          title: data.visibility.showIncidentTitle ? inc.title : 'Service Disruption',
          status: inc.status,
        };
        if (showAffectedService) {
          row.service = inc.serviceName || 'All Services';
        }
        if (data.visibility.showIncidentTimestamp) {
          row.startedAt = inc.startedAt.toISOString();
          row.resolvedAt = inc.resolvedAt ? inc.resolvedAt.toISOString() : 'Ongoing';
          row.durationMinutes = Math.round(inc.durationMinutes);
        }
        return row;
      });

      const incidentsCsv = buildCsv(incidentRows, incidentColumns as any);
      lines.push(incidentsCsv.replace(/^\uFEFF/, ''));
    }
  }

  // 4. Trailing OpsKnight Attribution
  lines.push('');
  lines.push('# ==============================================================================');
  lines.push('# Powered by OpsKnight - Open Incident Operations & Reliability Platform');
  lines.push('# https://opsknight.com');
  lines.push('# ==============================================================================');

  return '\uFEFF' + lines.join('\n');
}

/**
 * Builds an enhanced, high-fidelity vectorized PDF export
 */
export function buildEnhancedUptimePdf(data: StatusPageReportData): Buffer {
  const PAGE_WIDTH = 612; // Standard US Letter Width (pt)
  const PAGE_HEIGHT = 792; // Standard US Letter Height (pt)
  const MARGIN_X = 40;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 532 pt

  const [brandR, brandG, brandB] = hexToRgb(data.primaryColor);

  const pagesCommands: string[] = [];
  let curCommands = '';

  const startNewPage = () => {
    if (curCommands) {
      pagesCommands.push(curCommands);
    }
    curCommands = '';
  };

  const drawHeader = (pageNumber: number, totalPagesPlaceholder: string) => {
    // Dark Top Navigation Banner (y: 726 to 792, height 66)
    curCommands += '0.07 0.09 0.15 rg\n';
    curCommands += `0 726 ${PAGE_WIDTH} 66 re f\n`;

    // Brand accent line (y: 723 to 726, height 3)
    curCommands += `${brandR.toFixed(3)} ${brandG.toFixed(3)} ${brandB.toFixed(3)} rg\n`;
    curCommands += `0 723 ${PAGE_WIDTH} 3 re f\n`;

    // Title & Organization Name
    curCommands += '1.0 1.0 1.0 rg\n';
    const displayOrg = escapePdf(data.organizationName || data.pageName);
    curCommands += `BT /F2 16 Tf ${MARGIN_X} 760 Td (${displayOrg}) Tj ET\n`;

    // Subtitle
    curCommands += '0.65 0.72 0.85 rg\n';
    curCommands += `BT /F1 8 Tf ${MARGIN_X} 744 Td (MONTHLY SERVICE AVAILABILITY & SLA PERFORMANCE REPORT) Tj ET\n`;

    // Right-aligned Reporting Month / Year
    const monthYear = data.periodStart
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
      .toUpperCase();
    curCommands += '1.0 1.0 1.0 rg\n';
    curCommands += `BT /F2 12 Tf ${PAGE_WIDTH - MARGIN_X - 110} 755 Td (${escapePdf(monthYear)}) Tj ET\n`;

    // Metadata Sub-bar (y: 698 to 718)
    curCommands += '0.45 0.50 0.60 rg\n';
    const periodText = `Period: ${data.periodStart.toISOString().slice(0, 10)} to ${data.periodEnd.toISOString().slice(0, 10)} (UTC)`;
    const auditText = `Audit: Public Verified • Generated ${data.generatedAt.toISOString().slice(0, 16)} UTC`;
    curCommands += `BT /F1 8 Tf ${MARGIN_X} 704 Td (${escapePdf(periodText)}) Tj ET\n`;
    curCommands += `BT /F1 8 Tf ${PAGE_WIDTH - MARGIN_X - 250} 704 Td (${escapePdf(auditText)}) Tj ET\n`;

    // Divider under metadata
    curCommands += '0.88 0.90 0.94 RG 0.75 w\n';
    curCommands += `${MARGIN_X} 694 m ${PAGE_WIDTH - MARGIN_X} 694 l S\n`;
  };

  const drawFooter = (pageNumber: number, totalPagesPlaceholder: string) => {
    // Divider line above footer (y: 45)
    curCommands += '0.88 0.90 0.94 RG 0.75 w\n';
    curCommands += `${MARGIN_X} 45 m ${PAGE_WIDTH - MARGIN_X} 45 l S\n`;

    // Left Footer: Status Page URL / Domain
    curCommands += '0.45 0.50 0.60 rg\n';
    const siteRef = data.url ? `${data.pageName} • ${data.url}` : data.pageName;
    curCommands += `BT /F1 7.5 Tf ${MARGIN_X} 32 Td (${escapePdf(siteRef)}) Tj ET\n`;

    // Right Footer: OpsKnight Branding
    curCommands += '0.15 0.20 0.30 rg\n';
    curCommands += `BT /F2 8.5 Tf ${PAGE_WIDTH - MARGIN_X - 180} 32 Td (Powered by OpsKnight) Tj ET\n`;
    curCommands += '0.45 0.50 0.60 rg\n';
    curCommands += `BT /F1 7 Tf ${PAGE_WIDTH - MARGIN_X - 180} 22 Td (Open Incident Operations & Reliability) Tj ET\n`;

    // Page Number
    curCommands += '0.55 0.60 0.70 rg\n';
    curCommands += `BT /F1 7.5 Tf ${PAGE_WIDTH / 2 - 25} 32 Td (Page ${pageNumber} of ${totalPagesPlaceholder}) Tj ET\n`;
  };

  // --- PAGE 1: Header + KPI Cards + Services Table ---
  drawHeader(1, '{{TOTAL_PAGES}}');

  // Draw 4 Executive KPI Cards (y: 622 to 684, height 62)
  const cardY = 622;
  const cardH = 62;
  const cardW = (CONTENT_WIDTH - 30) / 4; // ~125.5 pt each
  const cardGap = 10;

  // Metric 1: Overall Availability
  const isExcellent = data.overallAvailability >= data.uptimeExcellentThreshold;
  const isGood = data.overallAvailability >= data.uptimeGoodThreshold;
  const availColor: [number, number, number] = isExcellent
    ? [0.05, 0.6, 0.4] // Emerald
    : isGood
      ? [0.85, 0.55, 0.05] // Amber
      : [0.85, 0.2, 0.2]; // Red

  const cardsData = [
    {
      title: 'SYSTEM AVAILABILITY',
      value: `${data.overallAvailability.toFixed(3)}%`,
      sub: `Target: ${data.uptimeExcellentThreshold.toFixed(2)}%`,
      valColor: availColor,
    },
    {
      title: 'SLA COMPLIANCE',
      value: `${data.slaComplianceRate.toFixed(0)}%`,
      sub: data.visibility.showServices
        ? `${data.services.filter(s => s.uptime >= s.slaTarget).length} of ${data.services.length} Met`
        : 'Overall System Audit',
      valColor:
        data.slaComplianceRate >= 100
          ? [0.05, 0.6, 0.4]
          : ([0.15, 0.2, 0.3] as [number, number, number]),
    },
    {
      title: data.visibility.showServices ? 'PUBLIC SERVICES' : 'PRIVACY MODE',
      value: data.visibility.showServices ? `${data.services.length}` : 'RESTRICTED',
      sub: data.visibility.showServices ? 'Monitored & Audited' : 'Services Hidden',
      valColor: [0.15, 0.2, 0.3] as [number, number, number],
    },
    {
      title: 'PUBLIC INCIDENTS',
      value: !data.visibility.showIncidents ? 'RESTRICTED' : `${data.incidents.length}`,
      sub: !data.visibility.showIncidents
        ? 'Hidden by Policy'
        : !data.visibility.showIncidentTimestamp
          ? data.incidents.length === 0
            ? '0 Recorded Outages'
            : `${data.incidents.length} Recorded Outage(s)`
          : data.incidents.length === 0
            ? '0m Total Outage'
            : `${Math.round(data.incidents.reduce((acc, i) => acc + i.durationMinutes, 0))}m Outage`,
      valColor: !data.visibility.showIncidents
        ? ([0.45, 0.5, 0.6] as [number, number, number])
        : data.incidents.length === 0
          ? ([0.05, 0.6, 0.4] as [number, number, number])
          : ([0.85, 0.35, 0.1] as [number, number, number]),
    },
  ];

  cardsData.forEach((card, idx) => {
    const cx = MARGIN_X + idx * (cardW + cardGap);
    // Background
    curCommands += '0.97 0.98 0.99 rg\n';
    curCommands += `${cx} ${cardY} ${cardW} ${cardH} re f\n`;
    // Border
    curCommands += '0.88 0.90 0.94 RG 1 w\n';
    curCommands += `${cx} ${cardY} ${cardW} ${cardH} re S\n`;

    // Title label
    curCommands += '0.45 0.50 0.60 rg\n';
    curCommands += `BT /F2 7 Tf ${cx + 8} ${cardY + cardH - 15} Td (${escapePdf(card.title)}) Tj ET\n`;

    // Value
    curCommands += `${card.valColor[0].toFixed(3)} ${card.valColor[1].toFixed(3)} ${card.valColor[2].toFixed(3)} rg\n`;
    curCommands += `BT /F2 15 Tf ${cx + 8} ${cardY + cardH - 35} Td (${escapePdf(card.value)}) Tj ET\n`;

    // Subtitle
    curCommands += '0.50 0.55 0.65 rg\n';
    curCommands += `BT /F1 7 Tf ${cx + 8} ${cardY + 10} Td (${escapePdf(card.sub)}) Tj ET\n`;
  });

  // Services Table Section (or restricted callout if services hidden)
  let currentY = 598;

  if (data.visibility.showServices) {
    // Section Header
    curCommands += '0.10 0.15 0.25 rg\n';
    curCommands += `BT /F2 11 Tf ${MARGIN_X} ${currentY} Td (Service Availability & SLA Performance) Tj ET\n`;
    currentY -= 16;

    // Table Column Layout
    // Total Content Width = 532 pt
    const colNameW = 232;
    const colTargetW = 70;
    const colUptimeW = 80;
    const colDownW = 75;
    const colBadgeW = 75;

    const colNameX = MARGIN_X;
    const colTargetX = colNameX + colNameW;
    const colUptimeX = colTargetX + colTargetW;
    const colDownX = colUptimeX + colUptimeW;
    const colBadgeX = colDownX + colDownW;

    // Draw Table Header Bar (height 20)
    curCommands += '0.12 0.16 0.24 rg\n';
    curCommands += `${MARGIN_X} ${currentY - 14} ${CONTENT_WIDTH} 20 re f\n`;

    curCommands += '1.0 1.0 1.0 rg\n';
    curCommands += `BT /F2 8 Tf ${colNameX + 8} ${currentY - 9} Td (SERVICE) Tj ET\n`;
    curCommands += `BT /F2 8 Tf ${colTargetX + 6} ${currentY - 9} Td (TARGET) Tj ET\n`;
    curCommands += `BT /F2 8 Tf ${colUptimeX + 6} ${currentY - 9} Td (ACTUAL) Tj ET\n`;
    curCommands += `BT /F2 8 Tf ${colDownX + 6} ${currentY - 9} Td (DOWNTIME) Tj ET\n`;
    curCommands += `BT /F2 8 Tf ${colBadgeX + 6} ${currentY - 9} Td (SLA STATUS) Tj ET\n`;

    currentY -= 20;

    // Render Table Rows
    const ROW_HEIGHT = 21;
    let pageNum = 1;

    for (let idx = 0; idx < data.services.length; idx++) {
      const s = data.services[idx];

      // Check if we need to paginate (keep at least 80pt for footer and potential incidents)
      if (currentY - ROW_HEIGHT < 75) {
        drawFooter(pageNum, '{{TOTAL_PAGES}}');
        startNewPage();
        pageNum++;
        drawHeader(pageNum, '{{TOTAL_PAGES}}');
        currentY = 670;

        // Re-draw Table Header Bar on new page
        curCommands += '0.12 0.16 0.24 rg\n';
        curCommands += `${MARGIN_X} ${currentY - 14} ${CONTENT_WIDTH} 20 re f\n`;

        curCommands += '1.0 1.0 1.0 rg\n';
        curCommands += `BT /F2 8 Tf ${colNameX + 8} ${currentY - 9} Td (SERVICE (CONT.)) Tj ET\n`;
        curCommands += `BT /F2 8 Tf ${colTargetX + 6} ${currentY - 9} Td (TARGET) Tj ET\n`;
        curCommands += `BT /F2 8 Tf ${colUptimeX + 6} ${currentY - 9} Td (ACTUAL) Tj ET\n`;
        curCommands += `BT /F2 8 Tf ${colDownX + 6} ${currentY - 9} Td (DOWNTIME) Tj ET\n`;
        curCommands += `BT /F2 8 Tf ${colBadgeX + 6} ${currentY - 9} Td (SLA STATUS) Tj ET\n`;

        currentY -= 20;
      }

      // Row Background (zebra striping)
      if (idx % 2 === 1) {
        curCommands += '0.97 0.98 0.99 rg\n';
        curCommands += `${MARGIN_X} ${currentY - 15} ${CONTENT_WIDTH} ${ROW_HEIGHT} re f\n`;
      }

      // Row Bottom Border
      curCommands += '0.90 0.92 0.95 RG 0.5 w\n';
      curCommands += `${MARGIN_X} ${currentY - 15} m ${PAGE_WIDTH - MARGIN_X} ${currentY - 15} l S\n`;

      // Service Name & Region
      const displayName =
        data.visibility.showServiceRegion && s.region ? `${s.name} (${s.region})` : s.name;
      curCommands += '0.10 0.15 0.25 rg\n';
      curCommands += `BT /F2 8.5 Tf ${colNameX + 8} ${currentY - 10} Td (${escapePdf(displayName)}) Tj ET\n`;

      // Target SLA
      curCommands += '0.45 0.50 0.60 rg\n';
      curCommands += `BT /F1 8.5 Tf ${colTargetX + 6} ${currentY - 10} Td (${s.slaTarget.toFixed(2)}%) Tj ET\n`;

      // Actual Availability %
      const isMet = s.uptime >= s.slaTarget;
      if (isMet) {
        curCommands += '0.05 0.55 0.35 rg\n'; // Green
      } else {
        curCommands += '0.85 0.30 0.10 rg\n'; // Amber / Red
      }
      curCommands += `BT /F2 8.5 Tf ${colUptimeX + 6} ${currentY - 10} Td (${s.uptime.toFixed(3)}%) Tj ET\n`;

      // Downtime Duration
      curCommands += '0.45 0.50 0.60 rg\n';
      curCommands += `BT /F1 8 Tf ${colDownX + 6} ${currentY - 10} Td (${escapePdf(formatDowntimeDuration(s.downtimeMinutes))}) Tj ET\n`;

      // Compliance Badge Pill
      const badgeText = isMet ? 'COMPLIANT' : 'BELOW TARGET';
      const badgeW = 68;
      const badgeH = 13;
      const badgeX = colBadgeX + 4;
      const badgeY = currentY - 12;

      if (isMet) {
        curCommands += '0.88 0.97 0.92 rg\n'; // Light emerald pill
        curCommands += `${badgeX} ${badgeY} ${badgeW} ${badgeH} re f\n`;
        curCommands += '0.04 0.50 0.30 rg\n'; // Dark emerald text
        curCommands += `BT /F2 6.5 Tf ${badgeX + 11} ${badgeY + 3.5} Td (${badgeText}) Tj ET\n`;
      } else {
        curCommands += '0.99 0.92 0.88 rg\n'; // Light amber/rose pill
        curCommands += `${badgeX} ${badgeY} ${badgeW} ${badgeH} re f\n`;
        curCommands += '0.80 0.25 0.10 rg\n'; // Dark amber text
        curCommands += `BT /F2 6.5 Tf ${badgeX + 6} ${badgeY + 3.5} Td (${badgeText}) Tj ET\n`;
      }

      currentY -= ROW_HEIGHT;
    }
  } else {
    // Executive summary callout box when services breakdown is hidden
    curCommands += '0.10 0.15 0.25 rg\n';
    curCommands += `BT /F2 11 Tf ${MARGIN_X} ${currentY} Td (System Availability & SLA Performance) Tj ET\n`;
    currentY -= 16;

    const panelH = 54;
    curCommands += '0.97 0.98 0.99 rg\n';
    curCommands += `${MARGIN_X} ${currentY - panelH} ${CONTENT_WIDTH} ${panelH} re f\n`;
    curCommands += '0.88 0.90 0.94 RG 1 w\n';
    curCommands += `${MARGIN_X} ${currentY - panelH} ${CONTENT_WIDTH} ${panelH} re S\n`;

    curCommands += '0.15 0.20 0.30 rg\n';
    curCommands += `BT /F2 9 Tf ${MARGIN_X + 14} ${currentY - 18} Td (INDIVIDUAL SERVICE BREAKDOWN RESTRICTED) Tj ET\n`;
    curCommands += '0.45 0.50 0.60 rg\n';
    curCommands += `BT /F1 8 Tf ${MARGIN_X + 14} ${currentY - 32} Td (Detailed individual service metrics are restricted by status page privacy policy.) Tj ET\n`;
    curCommands += `BT /F1 8 Tf ${MARGIN_X + 14} ${currentY - 44} Td (Overall system availability for this period is audited at ${data.overallAvailability.toFixed(3)}% against target ${data.uptimeExcellentThreshold.toFixed(2)}%.) Tj ET\n`;
    currentY -= panelH + 20;
  }

  let pageNum = 1;

  // Optional Public Incidents Section (if enabled)
  if (data.visibility.showIncidents) {
    if (currentY < 130) {
      drawFooter(pageNum, '{{TOTAL_PAGES}}');
      startNewPage();
      pageNum++;
      drawHeader(pageNum, '{{TOTAL_PAGES}}');
      currentY = 670;
    } else {
      currentY -= 16;
    }

    // Incidents Section Heading
    curCommands += '0.10 0.15 0.25 rg\n';
    curCommands += `BT /F2 11 Tf ${MARGIN_X} ${currentY} Td (Public Incident Log) Tj ET\n`;
    currentY -= 14;

    if (data.incidents.length === 0) {
      // Clean callout box: "No Incidents"
      const boxH = 34;
      curCommands += '0.94 0.98 0.95 rg\n'; // Light green tint
      curCommands += `${MARGIN_X} ${currentY - boxH} ${CONTENT_WIDTH} ${boxH} re f\n`;
      curCommands += '0.70 0.90 0.75 RG 1 w\n';
      curCommands += `${MARGIN_X} ${currentY - boxH} ${CONTENT_WIDTH} ${boxH} re S\n`;

      curCommands += '0.05 0.50 0.30 rg\n';
      curCommands += `BT /F2 8 Tf ${MARGIN_X + 12} ${currentY - 14} Td (NO SERVICE-IMPACTING OUTAGES RECORDED) Tj ET\n`;
      curCommands += '0.30 0.45 0.35 rg\n';
      curCommands += `BT /F1 7.5 Tf ${MARGIN_X + 12} ${currentY - 26} Td (All core public services operated within nominal reliability parameters during this reporting window.) Tj ET\n`;

      currentY -= boxH + 10;
    } else {
      // Mini Table of Incidents
      curCommands += '0.20 0.25 0.35 rg\n';
      curCommands += `${MARGIN_X} ${currentY - 14} ${CONTENT_WIDTH} 18 re f\n`;

      const showTimestamps = data.visibility.showIncidentTimestamp;
      const showAffectedService =
        data.visibility.showServices && data.visibility.showAffectedService;

      let incTitleW = 220;
      let incServW = 120;
      const incDateW = 110;
      const incDurW = 82;
      const incStatusW = 90;

      if (!showAffectedService && showTimestamps) {
        incTitleW = 340;
      } else if (showAffectedService && !showTimestamps) {
        incTitleW = 260;
        incServW = 182;
      } else if (!showAffectedService && !showTimestamps) {
        incTitleW = 442;
      }

      const incTitleX = MARGIN_X;
      const incServX = incTitleX + incTitleW;
      const incDateX = showAffectedService ? incServX + incServW : incTitleX + incTitleW;
      const incDurX = incDateX + incDateW;
      const incStatusX = showAffectedService ? incServX + incServW : incTitleX + incTitleW;

      curCommands += '1.0 1.0 1.0 rg\n';
      curCommands += `BT /F2 7.5 Tf ${incTitleX + 6} ${currentY - 10} Td (INCIDENT) Tj ET\n`;
      if (showAffectedService) {
        curCommands += `BT /F2 7.5 Tf ${incServX + 6} ${currentY - 10} Td (IMPACTED SERVICE) Tj ET\n`;
      }
      if (showTimestamps) {
        curCommands += `BT /F2 7.5 Tf ${incDateX + 6} ${currentY - 10} Td (DATE (UTC)) Tj ET\n`;
        curCommands += `BT /F2 7.5 Tf ${incDurX + 6} ${currentY - 10} Td (DURATION) Tj ET\n`;
      } else {
        curCommands += `BT /F2 7.5 Tf ${incStatusX + 6} ${currentY - 10} Td (STATUS) Tj ET\n`;
      }

      currentY -= 18;

      data.incidents.slice(0, 8).forEach((inc, incIdx) => {
        if (currentY < 75) {
          drawFooter(pageNum, '{{TOTAL_PAGES}}');
          startNewPage();
          pageNum++;
          drawHeader(pageNum, '{{TOTAL_PAGES}}');
          currentY = 670;
        }

        if (incIdx % 2 === 1) {
          curCommands += '0.98 0.98 0.99 rg\n';
          curCommands += `${MARGIN_X} ${currentY - 14} ${CONTENT_WIDTH} 18 re f\n`;
        }
        curCommands += '0.90 0.92 0.95 RG 0.5 w\n';
        curCommands += `${MARGIN_X} ${currentY - 14} m ${PAGE_WIDTH - MARGIN_X} ${currentY - 14} l S\n`;

        const incTitle = data.visibility.showIncidentTitle ? inc.title : 'Service Outage';
        curCommands += '0.15 0.20 0.30 rg\n';
        curCommands += `BT /F2 7.5 Tf ${incTitleX + 6} ${currentY - 10} Td (${escapePdf(incTitle.slice(0, showAffectedService ? 42 : 65))}) Tj ET\n`;

        if (showAffectedService) {
          const incServ = inc.serviceName || 'Infrastructure';
          curCommands += '0.40 0.45 0.55 rg\n';
          curCommands += `BT /F1 7.5 Tf ${incServX + 6} ${currentY - 10} Td (${escapePdf(incServ.slice(0, 24))}) Tj ET\n`;
        }

        if (showTimestamps) {
          const incDate = inc.startedAt.toISOString().slice(0, 10);
          curCommands += `BT /F1 7.5 Tf ${incDateX + 6} ${currentY - 10} Td (${escapePdf(incDate)}) Tj ET\n`;

          const incDur = `${Math.round(inc.durationMinutes)}m`;
          curCommands += `BT /F2 7.5 Tf ${incDurX + 6} ${currentY - 10} Td (${escapePdf(incDur)}) Tj ET\n`;
        } else {
          curCommands += '0.20 0.25 0.35 rg\n';
          curCommands += `BT /F2 7.5 Tf ${incStatusX + 6} ${currentY - 10} Td (${escapePdf(inc.status)}) Tj ET\n`;
        }

        currentY -= 18;
      });
    }
  }

  // Draw Footer on final page
  drawFooter(pageNum, '{{TOTAL_PAGES}}');
  startNewPage();

  const totalPages = pagesCommands.length;
  const finalPages = pagesCommands.map(cmd =>
    cmd.replace(/\{\{TOTAL_PAGES\}\}/g, String(totalPages))
  );

  // --- ASSEMBLE PDF-1.4 OBJECTS ---
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  let nextObjId = 6; // 1=Catalog, 2=Pages, 3=Font Regular, 4=Font Bold, 5=Font Italic

  finalPages.forEach(() => {
    pageObjectIds.push(nextObjId++);
    contentObjectIds.push(nextObjId++);
  });

  const objects: { id: number; data: string }[] = [];
  objects.push({ id: 1, data: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({
    id: 2,
    data: `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${finalPages.length} >>`,
  });
  objects.push({ id: 3, data: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });
  objects.push({ id: 4, data: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>' });
  objects.push({ id: 5, data: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>' });

  finalPages.forEach((streamContent, idx) => {
    const pageObjId = pageObjectIds[idx];
    const contentObjId = contentObjectIds[idx];

    objects.push({
      id: pageObjId,
      data: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    });

    const byteLen = Buffer.byteLength(streamContent, 'utf8');
    objects.push({
      id: contentObjId,
      data: `<< /Length ${byteLen} >>\nstream\n${streamContent}\nendstream`,
    });
  });

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
