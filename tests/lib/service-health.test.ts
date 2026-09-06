import { describe, it, expect } from 'vitest';
import {
  calculateServiceHealthScore,
  getHealthScoreColor,
  getHealthScoreLabel,
} from '@/lib/service-health';

describe('Service Health Utilities', () => {
  describe('calculateServiceHealthScore', () => {
    it('should return perfect score for healthy service', () => {
      const result = calculateServiceHealthScore({
        totalIncidents: 0,
        openIncidents: 0,
        criticalIncidents: 0,
        resolvedIncidents: 0,
        slaCompliance: 100,
      });

      expect(result.score).toBe(100);
      expect(result.grade).toBe('A');
    });

    it('should penalize critical incidents heavily', () => {
      const result = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 5,
        criticalIncidents: 2,
        resolvedIncidents: 5,
        slaCompliance: 100,
      });

      expect(result.score).toBeLessThan(70);
      // Grade should be D or E with critical incidents
      expect(['D', 'E']).toContain(result.grade);
    });

    it('should calculate score based on all factors', () => {
      const result = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 2,
        criticalIncidents: 0,
        resolvedIncidents: 8,
        avgResolutionTime: 60,
        slaCompliance: 95,
        recentIncidents: 2,
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(['A', 'B', 'C', 'D', 'E']).toContain(result.grade);
    });

    it('should include factor breakdowns', () => {
      const result = calculateServiceHealthScore({
        totalIncidents: 5,
        openIncidents: 1,
        criticalIncidents: 0,
        resolvedIncidents: 4,
        slaCompliance: 100,
      });

      expect(result.factors).toBeDefined();
      expect(result.factors.incidentVolume).toBeGreaterThanOrEqual(0);
      expect(result.factors.criticalIssues).toBeGreaterThanOrEqual(0);
      expect(result.factors.resolutionEfficiency).toBeGreaterThanOrEqual(0);
      expect(result.factors.slaCompliance).toBeGreaterThanOrEqual(0);
    });

    it('should handle high incident volume', () => {
      const result = calculateServiceHealthScore({
        totalIncidents: 100,
        openIncidents: 10,
        criticalIncidents: 0,
        resolvedIncidents: 90,
        slaCompliance: 100,
      });

      expect(result.score).toBeLessThan(90);
    });

    it('should reward fast resolution times', () => {
      const fastResult = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 0,
        criticalIncidents: 0,
        resolvedIncidents: 10,
        avgResolutionTime: 30,
        slaCompliance: 100,
      });

      const slowResult = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 0,
        criticalIncidents: 0,
        resolvedIncidents: 10,
        avgResolutionTime: 180,
        slaCompliance: 100,
      });

      expect(fastResult.score).toBeGreaterThan(slowResult.score);
    });

    it('should handle SLA compliance', () => {
      const highSla = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 0,
        criticalIncidents: 0,
        resolvedIncidents: 10,
        slaCompliance: 100,
      });

      const lowSla = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 0,
        criticalIncidents: 0,
        resolvedIncidents: 10,
        slaCompliance: 50,
      });

      expect(highSla.score).toBeGreaterThan(lowSla.score);
    });

    it('should penalize recent incidents', () => {
      const withRecent = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 0,
        criticalIncidents: 0,
        resolvedIncidents: 10,
        recentIncidents: 5,
        slaCompliance: 100,
      });

      const withoutRecent = calculateServiceHealthScore({
        totalIncidents: 10,
        openIncidents: 0,
        criticalIncidents: 0,
        resolvedIncidents: 10,
        recentIncidents: 0,
        slaCompliance: 100,
      });

      expect(withRecent.score).toBeLessThan(withoutRecent.score);
    });
  });

  describe('getHealthScoreColor', () => {
    it('should return success color for excellent score', () => {
      const color = getHealthScoreColor(95);
      
      expect(color).toBe('var(--success)');
    });

    it('should return appropriate color for good score', () => {
      const color = getHealthScoreColor(80);
      
      expect(color).toBe('#4ade80');
    });

    it('should return warning color for fair score', () => {
      const color = getHealthScoreColor(65);
      
      expect(color).toBe('var(--warning)');
    });

    it('should return danger color for poor score', () => {
      const color = getHealthScoreColor(30);
      
      expect(color).toBe('var(--danger)');
    });
  });

  describe('getHealthScoreLabel', () => {
    it('should return "Excellent" for high scores', () => {
      expect(getHealthScoreLabel(95)).toBe('Excellent');
      expect(getHealthScoreLabel(100)).toBe('Excellent');
    });

    it('should return "Good" for scores >= 75', () => {
      expect(getHealthScoreLabel(80)).toBe('Good');
      expect(getHealthScoreLabel(75)).toBe('Good');
    });

    it('should return "Fair" for scores >= 60', () => {
      expect(getHealthScoreLabel(70)).toBe('Fair');
      expect(getHealthScoreLabel(60)).toBe('Fair');
    });

    it('should return "Poor" for scores >= 40', () => {
      expect(getHealthScoreLabel(50)).toBe('Poor');
      expect(getHealthScoreLabel(40)).toBe('Poor');
    });

    it('should return "Critical" for low scores', () => {
      expect(getHealthScoreLabel(30)).toBe('Critical');
      expect(getHealthScoreLabel(0)).toBe('Critical');
    });
  });
});

