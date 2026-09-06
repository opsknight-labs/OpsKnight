import { describe, expect, it } from 'vitest';
import { IncidentCreateSchema, NotificationPatchSchema, StatusAnnouncementCreateSchema } from '@/lib/validation';

describe('validation schemas', () => {
    it('rejects invalid incident create payloads', () => {
        const result = IncidentCreateSchema.safeParse({ title: '', serviceId: 'svc', urgency: 'LOW' });
        expect(result.success).toBe(false);
    });

    it('accepts valid incident create payloads', () => {
        const result = IncidentCreateSchema.safeParse({ title: 'Test', serviceId: 'svc', urgency: 'HIGH' });
        expect(result.success).toBe(true);
    });

    it('requires notification patch intent', () => {
        const result = NotificationPatchSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('accepts status announcement create payloads', () => {
        const result = StatusAnnouncementCreateSchema.safeParse({
            statusPageId: 'sp1',
            title: 'Maintenance',
            message: 'Planned work',
            startDate: new Date().toISOString(),
            affectedServiceIds: ['svc-1', 'svc-2'],
        });
        expect(result.success).toBe(true);
    });
});

