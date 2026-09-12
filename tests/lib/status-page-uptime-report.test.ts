import { describe, expect, it } from 'vitest';
import {
  buildEnhancedUptimeCsv,
  buildEnhancedUptimePdf,
  StatusPageReportData,
} from '@/lib/status-pages/reports/uptime-report-generator';

const mockReportData: StatusPageReportData = {
  pageId: 'page-123',
  pageName: 'OpsKnight Global Status',
  organizationName: 'OpsKnight Inc',
  url: 'https://status.opsknight.com',
  primaryColor: '#6366f1',
  periodStart: new Date(Date.UTC(2026, 8, 1)),
  periodEnd: new Date(Date.UTC(2026, 9, 1)),
  generatedAt: new Date(Date.UTC(2026, 8, 12, 14, 30)),
  uptimeExcellentThreshold: 99.9,
  uptimeGoodThreshold: 99.0,
  visibility: {
    showServices: true,
    showServiceRegion: true,
    showServiceDescription: true,
    showIncidents: true,
    showIncidentTitle: true,
    showIncidentDescription: true,
    showAffectedService: true,
    showIncidentTimestamp: true,
  },
  services: [
    {
      id: 'srv-1',
      name: 'API Gateway',
      region: 'us-east-1',
      description: 'Primary ingress API gateway',
      uptime: 99.995,
      slaTarget: 99.9,
      downtimeMinutes: 2.16,
    },
    {
      id: 'srv-2',
      name: 'Database Cluster',
      region: 'us-east-1',
      description: 'High availability relational store',
      uptime: 99.85,
      slaTarget: 99.9,
      downtimeMinutes: 64.8,
    },
  ],
  incidents: [
    {
      id: 'inc-1',
      title: 'Database connection pool saturation',
      serviceName: 'Database Cluster',
      startedAt: new Date(Date.UTC(2026, 8, 5, 10, 0)),
      resolvedAt: new Date(Date.UTC(2026, 8, 5, 11, 5)),
      durationMinutes: 65,
      status: 'RESOLVED',
    },
  ],
  overallAvailability: 99.922,
  slaComplianceRate: 50.0,
};

describe('Status Page Uptime Report Generator', () => {
  describe('buildEnhancedUptimeCsv', () => {
    it('generates a branded CSV with metadata header, services, incidents, and OpsKnight attribution', () => {
      const csv = buildEnhancedUptimeCsv(mockReportData);

      // Metadata comments
      expect(csv).toContain('# OPSKNIGHT STATUS PAGE AVAILABILITY & SLA AUDIT REPORT');
      expect(csv).toContain('# Organization: OpsKnight Inc');
      expect(csv).toContain('# Status Page: OpsKnight Global Status');
      expect(csv).toContain('# Status Page URL: https://status.opsknight.com');
      expect(csv).toContain('# Target SLA Threshold: 99.900%');
      expect(csv).toContain('# Overall System Availability: 99.922%');
      expect(csv).toContain('# Total Public Services: 2');

      // Columns
      expect(csv).toContain('Service Name');
      expect(csv).toContain('Region');
      expect(csv).toContain('Actual Availability %');
      expect(csv).toContain('Compliance Status');

      // Rows
      expect(csv).toContain('API Gateway');
      expect(csv).toContain('us-east-1');
      expect(csv).toContain('99.995');
      expect(csv).toContain('MET');
      expect(csv).toContain('Database Cluster');
      expect(csv).toContain('99.850');
      expect(csv).toContain('BELOW_TARGET');

      // Public incidents section
      expect(csv).toContain('# PUBLIC INCIDENT LOG (REPORTING PERIOD)');
      expect(csv).toContain('Database connection pool saturation');
      expect(csv).toContain('Database Cluster');

      // OpsKnight trailing attribution
      expect(csv).toContain(
        '# Powered by OpsKnight - Open Incident Operations & Reliability Platform'
      );
      expect(csv).toContain('# https://opsknight.com');
    });

    it('honors privacy boundary by omitting region and incidents when disabled in visibility', () => {
      const privateData: StatusPageReportData = {
        ...mockReportData,
        visibility: {
          ...mockReportData.visibility,
          showServiceRegion: false,
          showIncidents: false,
        },
      };

      const csv = buildEnhancedUptimeCsv(privateData);

      expect(csv).not.toContain('Region');
      expect(csv).not.toContain('us-east-1');
      expect(csv).not.toContain('# PUBLIC INCIDENT LOG (REPORTING PERIOD)');
      expect(csv).not.toContain('Database connection pool saturation');
      expect(csv).toContain('API Gateway');
      expect(csv).toContain('# Powered by OpsKnight');
    });
  });

  describe('buildEnhancedUptimePdf', () => {
    it('generates a valid, standards-compliant PDF-1.4 binary buffer with branding and OpsKnight attribution', () => {
      const pdf = buildEnhancedUptimePdf(mockReportData);

      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(1000);

      const str = pdf.toString('utf8');

      // PDF 1.4 header
      expect(str.startsWith('%PDF-1.4\n')).toBe(true);

      // PDF Catalog and structure
      expect(str).toContain('/Type /Catalog');
      expect(str).toContain('/Type /Pages');
      expect(str).toContain('/Type /Page');

      // Fonts
      expect(str).toContain('/BaseFont /Helvetica');
      expect(str).toContain('/BaseFont /Helvetica-Bold');
      expect(str).toContain('/BaseFont /Helvetica-Oblique');

      // Branding & OpsKnight attribution in text stream
      expect(str).toContain('OpsKnight Inc');
      expect(str).toContain('MONTHLY SERVICE AVAILABILITY & SLA PERFORMANCE REPORT');
      expect(str).toContain('Powered by OpsKnight');
      expect(str).toContain('Open Incident Operations & Reliability');

      // Services and SLA metrics
      expect(str).toContain('API Gateway');
      expect(str).toContain('99.995%');
      expect(str).toContain('COMPLIANT');
      expect(str).toContain('BELOW TARGET');

      // Trailer and EOF
      expect(str).toContain('trailer');
      expect(str).toContain('startxref');
      expect(str.trim().endsWith('%%EOF')).toBe(true);
    });

    it('renders clean callout when public incidents is enabled but zero incidents occurred', () => {
      const zeroIncidentData: StatusPageReportData = {
        ...mockReportData,
        incidents: [],
      };

      const pdf = buildEnhancedUptimePdf(zeroIncidentData);
      const str = pdf.toString('utf8');

      expect(str).toContain('NO SERVICE-IMPACTING OUTAGES RECORDED');
      expect(str).toContain('nominal reliability parameters');
    });
  });
});
