import { describe, expect, it } from 'vitest';
import {
  buildEnhancedUptimeCsv,
  buildEnhancedUptimePdf,
  type StatusPageReportData,
} from '@/lib/status-pages/reports/uptime-report-generator';

const base = (showServices: boolean): StatusPageReportData => ({
  pageId: 'p',
  pageName: 'Acme',
  organizationName: 'Acme',
  periodStart: new Date('2026-10-01T00:00:00Z'),
  periodEnd: new Date('2026-11-01T00:00:00Z'),
  generatedAt: new Date('2026-11-02T00:00:00Z'),
  uptimeExcellentThreshold: 99.9,
  uptimeGoodThreshold: 99,
  visibility: {
    showServices,
    showServiceRegion: false,
    showIncidents: false,
    showIncidentTitle: false,
    showIncidentDescription: false,
    showAffectedService: false,
    showIncidentTimestamp: false,
  },
  services: [],
  incidents: [],
  overallAvailability: 100,
  slaComplianceRate: 100,
  businessServices: [
    {
      id: 'g1',
      name: 'Checkout',
      uptime30: 99.5,
      uptime90: 99.95,
      downtimeMinutes30: 216,
      incidentCount30: 2,
      slaTarget: 99.9,
    },
  ],
});

describe('business-service rows in the uptime report', () => {
  it('adds them to the CSV and PDF when services are public', () => {
    const csv = buildEnhancedUptimeCsv(base(true));
    expect(csv).toContain('Business Service');
    expect(csv).toContain('Checkout');
    expect(csv).toContain('99.500');
    expect(csv).toContain('216');
    expect(buildEnhancedUptimePdf(base(true)).toString('latin1')).toContain('Checkout');
  });
  it('omits them when the page hides services', () => {
    expect(buildEnhancedUptimeCsv(base(false))).not.toContain('Checkout');
    expect(buildEnhancedUptimePdf(base(false)).toString('latin1')).not.toContain('Checkout');
  });
});
