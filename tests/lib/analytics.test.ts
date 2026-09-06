import { describe, it, expect } from 'vitest';

describe('Analytics and Reporting', () => {
  describe('Incident Analytics', () => {
    it('should calculate incident metrics', () => {
      const incidents = [
        { urgency: 'HIGH', status: 'RESOLVED', resolutionTime: 120 },
        { urgency: 'HIGH', status: 'RESOLVED', resolutionTime: 240 },
        { urgency: 'MEDIUM', status: 'OPEN', resolutionTime: null },
      ];

      const metrics = {
        total: incidents.length,
        resolved: incidents.filter(i => i.status === 'RESOLVED').length,
        avgResolutionTime:
          incidents
            .filter(i => i.resolutionTime)
            .reduce((sum, i) => sum + (i.resolutionTime || 0), 0) / 2,
      };

      expect(metrics.total).toBe(3);
      expect(metrics.resolved).toBe(2);
      expect(metrics.avgResolutionTime).toBe(180);
    });

    it('should group incidents by urgency', () => {
      const incidents = [
        { urgency: 'HIGH' },
        { urgency: 'HIGH' },
        { urgency: 'LOW' },
        { urgency: 'MEDIUM' },
      ];

      const grouped = incidents.reduce(
        (acc, inc) => {
          acc[inc.urgency] = (acc[inc.urgency] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      expect(grouped.HIGH).toBe(2);
      expect(grouped.LOW).toBe(1);
      expect(grouped.MEDIUM).toBe(1);
    });

    it('should calculate MTTR (Mean Time To Resolve)', () => {
      const resolutionTimes = [60, 120, 90, 150]; // minutes
      const mttr = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;

      expect(mttr).toBe(105);
    });

    it('should calculate MTTA (Mean Time To Acknowledge)', () => {
      const acknowledgeTimes = [5, 10, 8, 12]; // minutes
      const mtta = acknowledgeTimes.reduce((a, b) => a + b, 0) / acknowledgeTimes.length;

      expect(mtta).toBe(8.75);
    });
  });

  describe('Time-based Analytics', () => {
    it('should group incidents by hour', () => {
      const incidents = [
        { createdAt: new Date('2024-01-01T10:00:00Z') },
        { createdAt: new Date('2024-01-01T10:30:00Z') },
        { createdAt: new Date('2024-01-01T11:00:00Z') },
      ];

      const byHour = incidents.reduce(
        (acc, inc) => {
          const hour = inc.createdAt.getUTCHours();
          acc[hour] = (acc[hour] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>
      );

      expect(byHour[10]).toBe(2);
      expect(byHour[11]).toBe(1);
    });

    it('should group incidents by day of week', () => {
      const incidents = [
        { createdAt: new Date('2024-01-01T12:00:00Z') }, // Monday
        { createdAt: new Date('2024-01-02T12:00:00Z') }, // Tuesday
        { createdAt: new Date('2024-01-01T14:00:00Z') }, // Monday
      ];

      const byDay = incidents.reduce(
        (acc, inc) => {
          const day = inc.createdAt.getUTCDay();
          acc[day] = (acc[day] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>
      );

      expect(byDay[1]).toBe(2); // Monday
      expect(byDay[2]).toBe(1); // Tuesday
    });
  });

  describe('Service Analytics', () => {
    it('should calculate service uptime', () => {
      const calculateUptime = (totalTime: number, downtime: number) => {
        return ((totalTime - downtime) / totalTime) * 100;
      };

      const uptime = calculateUptime(720, 5); // 720 hours, 5 hours down

      expect(uptime).toBeCloseTo(99.31, 2);
    });

    it('should track service health changes', () => {
      const healthHistory = [
        { timestamp: new Date('2024-01-01T00:00:00Z'), status: 'OPERATIONAL' },
        { timestamp: new Date('2024-01-01T12:00:00Z'), status: 'DEGRADED' },
        { timestamp: new Date('2024-01-01T14:00:00Z'), status: 'OPERATIONAL' },
      ];

      const degradedPeriods = healthHistory.filter(h => h.status === 'DEGRADED');

      expect(degradedPeriods).toHaveLength(1);
    });
  });

  describe('Team Performance', () => {
    it('should calculate team response metrics', () => {
      const teamIncidents = [
        { teamId: 'team-1', responseTime: 15 },
        { teamId: 'team-1', responseTime: 20 },
        { teamId: 'team-2', responseTime: 10 },
      ];

      const team1Incidents = teamIncidents.filter(i => i.teamId === 'team-1');
      const avgResponseTime =
        team1Incidents.reduce((sum, i) => sum + i.responseTime, 0) / team1Incidents.length;

      expect(avgResponseTime).toBe(17.5);
    });

    it('should rank teams by performance', () => {
      const teams = [
        { id: 'team-1', avgResolutionTime: 120 },
        { id: 'team-2', avgResolutionTime: 90 },
        { id: 'team-3', avgResolutionTime: 150 },
      ];

      const ranked = teams.sort((a, b) => a.avgResolutionTime - b.avgResolutionTime);

      expect(ranked[0].id).toBe('team-2'); // Best performance
      expect(ranked[2].id).toBe('team-3'); // Worst performance
    });
  });

  describe('Trend Analysis', () => {
    it('should calculate incident trend', () => {
      const weeklyIncidents = [10, 12, 15, 18, 20];

      const trend = weeklyIncidents[weeklyIncidents.length - 1] - weeklyIncidents[0];
      const percentChange = (trend / weeklyIncidents[0]) * 100;

      expect(trend).toBe(10);
      expect(percentChange).toBe(100);
    });

    it('should detect anomalies', () => {
      const detectAnomaly = (value: number, average: number, threshold: number) => {
        const deviation = Math.abs(value - average);
        const percentDeviation = (deviation / average) * 100;
        return percentDeviation > threshold;
      };

      expect(detectAnomaly(100, 50, 50)).toBe(true); // 100% deviation
      expect(detectAnomaly(60, 50, 50)).toBe(false); // 20% deviation
    });
  });

  describe('Custom Reports', () => {
    it('should generate date range report', () => {
      const incidents = [
        { createdAt: new Date('2024-01-01'), status: 'RESOLVED' },
        { createdAt: new Date('2024-01-05'), status: 'RESOLVED' },
        { createdAt: new Date('2024-01-10'), status: 'OPEN' },
      ];

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-07');

      const filtered = incidents.filter(i => i.createdAt >= startDate && i.createdAt <= endDate);

      expect(filtered).toHaveLength(2);
    });

    it('should export report data', () => {
      const reportData = {
        period: '2024-01',
        totalIncidents: 50,
        resolvedIncidents: 45,
        avgResolutionTime: 120,
        slaCompliance: 90,
      };

      const csv = Object.entries(reportData)
        .map(([key, value]) => `${key},${value}`)
        .join('\n');

      expect(csv).toContain('totalIncidents,50');
      expect(csv).toContain('slaCompliance,90');
    });
  });
});
