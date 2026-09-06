import { describe, it, expect } from 'vitest';
import {
  IncidentCreateSchema,
  IncidentPatchSchema,
  EventSchema,
  StatusPageSettingsSchema,
  CustomFieldCreateSchema,
} from '@/lib/validation';

describe('Extended Validation Schema Tests', () => {
  describe('IncidentCreateSchema', () => {
    it('should validate a complete incident payload', () => {
      const payload = {
        title: 'Test Incident',
        description: 'This is a test incident',
        serviceId: 'service-123',
        urgency: 'HIGH' as const,
        priority: 'P1',
      };
      const result = IncidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate incident without description', () => {
      const payload = {
        title: 'Test Incident',
        serviceId: 'service-123',
        urgency: 'HIGH' as const,
      };
      const result = IncidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject title that is too long', () => {
      const payload = {
        title: 'a'.repeat(501),
        serviceId: 'service-123',
        urgency: 'HIGH' as const,
      };
      const result = IncidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('title');
      }
    });

    it('should reject empty title', () => {
      const payload = {
        title: '',
        serviceId: 'service-123',
        urgency: 'HIGH' as const,
      };
      const result = IncidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject invalid urgency', () => {
      const payload = {
        title: 'Test Incident',
        serviceId: 'service-123',
        urgency: 'INVALID_URGENCY' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      };
      const result = IncidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('IncidentPatchSchema', () => {
    it('should validate patch with status only', () => {
      const payload = {
        status: 'RESOLVED' as const,
      };
      const result = IncidentPatchSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate patch with urgency only', () => {
      const payload = {
        urgency: 'LOW' as const,
      };
      const result = IncidentPatchSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate patch with all fields', () => {
      const payload = {
        status: 'ACKNOWLEDGED' as const,
        urgency: 'HIGH' as const,
        assigneeId: 'user-123',
      };
      const result = IncidentPatchSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const payload = {
        status: 'INVALID' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      };
      const result = IncidentPatchSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('EventSchema', () => {
    it('should validate trigger event', () => {
      const payload = {
        event_action: 'trigger' as const,
        dedup_key: 'alert-123',
        payload: {
          summary: 'CPU usage high',
          source: 'monitoring',
          severity: 'critical' as const,
        },
      };
      const result = EventSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate resolve event', () => {
      const payload = {
        event_action: 'resolve' as const,
        dedup_key: 'alert-123',
        payload: {
          summary: 'CPU usage normalized',
          source: 'monitoring',
          severity: 'info' as const,
        },
      };
      const result = EventSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject missing dedup_key', () => {
      const payload = {
        event_action: 'trigger' as const,
        payload: {
          summary: 'Test',
          source: 'test',
          severity: 'critical' as const,
        },
      };
      const result = EventSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject invalid severity', () => {
      const payload = {
        event_action: 'trigger' as const,
        dedup_key: 'alert-123',
        payload: {
          summary: 'Test',
          source: 'test',
          severity: 'low' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      };
      const result = EventSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('StatusPageSettingsSchema', () => {
    it('should validate valid email in contactEmail', () => {
      const payload = {
        contactEmail: 'support@example.com',
      };
      const result = StatusPageSettingsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid email in contactEmail', () => {
      const payload = {
        contactEmail: 'invalid-email',
      };
      const result = StatusPageSettingsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should validate valid URL in contactUrl', () => {
      const payload = {
        contactUrl: 'https://example.com/support',
      };
      const result = StatusPageSettingsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid URL in contactUrl', () => {
      const payload = {
        contactUrl: 'not-a-url',
      };
      const result = StatusPageSettingsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('CustomFieldCreateSchema', () => {
    it('should validate valid custom field', () => {
      const payload = {
        name: 'Environment',
        key: 'environment',
        type: 'SELECT' as const,
        required: false,
      };
      const result = CustomFieldCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject key with invalid characters', () => {
      const payload = {
        name: 'Environment',
        key: 'environment-key',
        type: 'TEXT' as const,
      };
      const result = CustomFieldCreateSchema.safeParse(payload);
      // Should fail because key contains hyphen (not allowed per regex)
      expect(result.success).toBe(false);
    });

    it('should validate key with underscores', () => {
      const payload = {
        name: 'Environment',
        key: 'environment_key',
        type: 'TEXT' as const,
      };
      const result = CustomFieldCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });
});
