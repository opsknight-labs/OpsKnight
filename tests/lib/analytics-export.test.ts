import { describe, expect, it } from 'vitest';
import { parseAnalyticsParams } from '@/lib/analytics/params';
import { METRICS } from '@/lib/analytics/definitions';
import {
  buildAnalyticsCsv,
  escapeCsvCell,
  metricHeader,
  metricValue,
  type AnalyticsExportData,
} from '@/lib/analytics-export';

const empty = {
  incidents: 0,
  mttaP50: null,
  mttaP90: null,
  mttrP50: null,
  mttrP90: null,
  ackSla: null,
  resolveSla: null,
  escalationRate: null,
  afterHoursRate: null,
};

function data(overrides: Partial<AnalyticsExportData> = {}): AnalyticsExportData {
  return {
    params: parseAnalyticsParams({ range: '7d', urgency: 'HIGH' }),
    window: {
      start: new Date('2026-01-08T00:00:00Z'),
      end: new Date('2026-01-15T00:00:00Z'),
      previousStart: new Date('2026-01-01T00:00:00Z'),
      previousEnd: new Date('2026-01-08T00:00:00Z'),
      bucket: 'day',
      timeZone: 'UTC',
      businessTimeZone: 'UTC',
      isClipped: false,
      hasPrevious: true,
    },
    generatedAt: new Date('2026-01-15T00:00:00Z'),
    kpis: {
      current: { ...empty, incidents: 3, mttaP50: 90_000, ackSla: 66.666 },
      previous: empty,
      openNow: 1,
    },
    services: [],
    trend: [],
    responders: [],
    noise: {
      alerts: 0,
      incidents: 0,
      alertsPerIncident: null,
      resolved: 0,
      autoResolved: 0,
      autoResolvedRate: null,
      noisyServices: [],
      recurringTitles: [],
    },
    followThrough: {
      highResolved: 0,
      postmortemsPublished: 0,
      postmortemsDraft: 0,
      postmortemRate: null,
      actionItemsOpen: 0,
      actionItemsOverdue: 0,
      actionItemsCompleted: 0,
    },
    incidents: [],
    incidentLimit: 2,
    ...overrides,
  };
}

const incident = (id: string, title: string) => ({
  id,
  title,
  status: 'OPEN',
  urgency: 'HIGH',
  priority: null,
  service: 'api',
  assignee: null,
  createdAt: new Date('2026-01-10T00:00:00Z'),
  acknowledgedAt: null,
  resolvedAt: null,
});

describe('escapeCsvCell', () => {
  it('neutralises formula prefixes in text but leaves numbers alone', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('-cmd')).toBe("'-cmd");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('  =1')).toBe("'  =1");
    expect(escapeCsvCell(-5)).toBe('-5');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });
});

describe('metric formatting', () => {
  it('takes headers from METRICS and converts units', () => {
    expect(metricHeader('mttaP50')).toBe(`${METRICS.mttaP50.label} (min)`);
    expect(metricHeader('ackSla')).toBe(`${METRICS.ackSla.label} (%)`);
    expect(metricValue('mttaP50', 90_000)).toBe(1.5);
    expect(metricValue('ackSla', 66.666)).toBe(66.7);
    expect(metricValue('ackSla', null)).toBeNull();
  });
});

describe('buildAnalyticsCsv', () => {
  it('starts with a BOM and writes KPI rows from the registry', () => {
    const csv = buildAnalyticsCsv(data());
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`\r\n${METRICS.incidents.label},3,0,`);
    expect(csv).toContain(`\r\n${METRICS.openNow.label},1,,`);
    expect(csv).toContain(`\r\n${METRICS.mttaP50.label} (min),1.5,,`);
    expect(csv).toContain('Filters,range=7d; urgency=HIGH');
  });

  it('includes breakdowns, availability and responder handling hours like the page', () => {
    const row = {
      ...empty,
      key: 'P1',
      label: 'P1',
      incidents: 4,
      previousIncidents: 2,
      mttrP50: 600_000,
    };
    const csv = buildAnalyticsCsv(
      data({
        breakdowns: [{ title: 'priority', rows: [row] }],
        availability: [
          {
            id: 's',
            name: 'api',
            uptime: 99.5,
            downtimeMs: 120_000,
            objective: { name: 'API SLO', target: 99.9 },
            budgetRemaining: -400,
          },
        ],
        responders: [
          {
            id: 'u',
            name: 'Ana',
            avatarUrl: null,
            incidents: 2,
            working: 1,
            evening: 1,
            overnight: 0,
            onCallHours: 40,
            handlingHours: 3.25,
            handlingEveningHours: 1,
            handlingOvernightHours: 0.5,
          } as AnalyticsExportData['responders'][number],
        ],
      })
    );
    expect(csv).toContain('\r\nBreakdown by priority\r\nPriority,');
    expect(csv).toContain('\r\nP1,4,2,,10,');
    expect(csv).toContain('\r\nAvailability\r\n');
    expect(csv).toContain('\r\napi,99.5,2,API SLO,99.9,-400\r\n');
    expect(csv).toContain('\r\nAna,2,1,1,0,40,3.3,1.5\r\n');
  });

  it('escapes injected incident titles', () => {
    const csv = buildAnalyticsCsv(data({ incidents: [incident('a', '=cmd|calc')] }));
    expect(csv).toContain(",'=cmd|calc,");
    expect(csv).not.toContain(',=cmd');
  });

  it('caps the incident list and says so', () => {
    const csv = buildAnalyticsCsv(
      data({ incidents: [incident('a', 'one'), incident('b', 'two'), incident('c', 'three')] })
    );
    expect(csv).toContain('Incidents (newest 2 of 3;');
    expect(csv).toContain('\r\nb,two,');
    expect(csv).not.toContain('\r\nc,three,');
  });
});
