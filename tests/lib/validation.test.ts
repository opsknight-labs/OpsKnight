import { describe, it, expect } from 'vitest';
import { IncidentCreateSchema, EventSchema } from '@/lib/validation';

describe('Validation Schemas', () => {
  describe('IncidentCreateSchema', () => {
    it('should validate valid incident data', () => {
      const validData = {
        title: 'Test Incident',
        description: 'Test description',
        serviceId: 'service-123',
        urgency: 'HIGH' as const,
        priority: 'P1',
      };

      const result = IncidentCreateSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty title', () => {
      const invalidData = {
        title: '',
        serviceId: 'service-123',
        urgency: 'HIGH' as const,
      };

      const result = IncidentCreateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject title exceeding max length', () => {
      const invalidData = {
        title: 'a'.repeat(501), // Exceeds 500 char limit
        serviceId: 'service-123',
        urgency: 'HIGH' as const,
      };

      const result = IncidentCreateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid urgency', () => {
      const invalidData = {
        title: 'Test Incident',
        serviceId: 'service-123',
        urgency: 'INVALID' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      };

      const result = IncidentCreateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should allow medium urgency', () => {
      const validData = {
        title: 'Test Incident',
        serviceId: 'service-123',
        urgency: 'MEDIUM' as const,
      };

      const result = IncidentCreateSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe('EventSchema', () => {
    it('should validate valid event data', () => {
      const validData = {
        event_action: 'trigger' as const,
        dedup_key: 'test-key-123',
        payload: {
          summary: 'Test summary',
          source: 'test-source',
          severity: 'critical' as const,
        },
      };

      const result = EventSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty dedup_key', () => {
      const invalidData = {
        event_action: 'trigger' as const,
        dedup_key: '',
        payload: {
          summary: 'Test summary',
          source: 'test-source',
          severity: 'critical' as const,
        },
      };

      const result = EventSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid event_action', () => {
      const invalidData = {
        event_action: 'invalid' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        dedup_key: 'test-key',
        payload: {
          summary: 'Test summary',
          source: 'test-source',
          severity: 'critical' as const,
        },
      };

      const result = EventSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
