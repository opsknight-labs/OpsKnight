import { describe, it, expect } from 'vitest';
import {
  StatusPageSettingsSchema,
  StatusAnnouncementCreateSchema,
  StatusAnnouncementPatchSchema,
} from '@/lib/validation';

describe('Status Page Validation Schemas', () => {
  describe('StatusPageSettingsSchema', () => {
    it('should validate valid status page settings', () => {
      const validData = {
        name: 'My Status Page',
        subdomain: 'status',
        customDomain: 'status.example.com',
        enabled: true,
        showServices: true,
        showIncidents: true,
        showMetrics: true,
        footerText: '© 2024 Example Inc.',
        contactEmail: 'support@example.com',
        contactUrl: 'https://example.com/contact',
        privacyMode: 'PUBLIC',
        showIncidentDetails: true,
        maxIncidentsToShow: 50,
        incidentHistoryDays: 90,
      };

      const result = StatusPageSettingsSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate minimal settings', () => {
      const minimalData = {
        enabled: false,
      };

      const result = StatusPageSettingsSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
    });

    it('should validate privacy mode values', () => {
      const validModes = ['PUBLIC', 'RESTRICTED', 'PRIVATE'];

      validModes.forEach(mode => {
        const result = StatusPageSettingsSchema.safeParse({ privacyMode: mode });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid privacy mode', () => {
      const result = StatusPageSettingsSchema.safeParse({
        privacyMode: 'INVALID',
      });
      expect(result.success).toBe(false);
    });

    it('should validate name length', () => {
      const tooLong = {
        name: 'a'.repeat(201), // Exceeds 200 char limit
      };

      const result = StatusPageSettingsSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it('should validate subdomain length', () => {
      const tooLong = {
        subdomain: 'a'.repeat(201),
      };

      const result = StatusPageSettingsSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it('should validate custom domain length', () => {
      const tooLong = {
        customDomain: 'a'.repeat(201),
      };

      const result = StatusPageSettingsSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it('should validate email format', () => {
      const invalidEmail = {
        contactEmail: 'not-an-email',
      };

      const result = StatusPageSettingsSchema.safeParse(invalidEmail);
      expect(result.success).toBe(false);
    });

    it('should accept valid email', () => {
      const validEmail = {
        contactEmail: 'support@example.com',
      };

      const result = StatusPageSettingsSchema.safeParse(validEmail);
      expect(result.success).toBe(true);
    });

    it('should validate URL format', () => {
      const invalidUrl = {
        contactUrl: 'not-a-url',
      };

      const result = StatusPageSettingsSchema.safeParse(invalidUrl);
      expect(result.success).toBe(false);
    });

    it('should accept valid URL', () => {
      const validUrl = {
        contactUrl: 'https://example.com/contact',
      };

      const result = StatusPageSettingsSchema.safeParse(validUrl);
      expect(result.success).toBe(true);
    });

    it('should validate maxIncidentsToShow range', () => {
      const tooLow = {
        maxIncidentsToShow: 0,
      };

      const result = StatusPageSettingsSchema.safeParse(tooLow);
      expect(result.success).toBe(false);

      const tooHigh = {
        maxIncidentsToShow: 501,
      };

      const result2 = StatusPageSettingsSchema.safeParse(tooHigh);
      expect(result2.success).toBe(false);

      const valid = {
        maxIncidentsToShow: 100,
      };

      const result3 = StatusPageSettingsSchema.safeParse(valid);
      expect(result3.success).toBe(true);
    });

    it('should validate incidentHistoryDays range', () => {
      const tooLow = {
        incidentHistoryDays: 0,
      };

      const result = StatusPageSettingsSchema.safeParse(tooLow);
      expect(result.success).toBe(false);

      const tooHigh = {
        incidentHistoryDays: 366,
      };

      const result2 = StatusPageSettingsSchema.safeParse(tooHigh);
      expect(result2.success).toBe(false);

      const valid = {
        incidentHistoryDays: 30,
      };

      const result3 = StatusPageSettingsSchema.safeParse(valid);
      expect(result3.success).toBe(true);
    });

    it('should accept null values for nullable fields', () => {
      const dataWithNulls = {
        subdomain: null,
        customDomain: null,
        footerText: null,
        contactEmail: null,
        contactUrl: null,
        allowedCustomFields: null,
        dataRetentionDays: null,
        authProvider: null,
      };

      const result = StatusPageSettingsSchema.safeParse(dataWithNulls);
      expect(result.success).toBe(true);
    });

    it('should validate serviceConfigs structure', () => {
      const validServiceConfigs = {
        serviceConfigs: {
          'service-1': {
            displayName: 'API Service',
            order: 1,
            showOnPage: true,
          },
          'service-2': {
            displayName: 'Database Service',
            order: 2,
            showOnPage: false,
          },
        },
      };

      const result = StatusPageSettingsSchema.safeParse(validServiceConfigs);
      expect(result.success).toBe(true);
    });

    it('should accept empty serviceConfigs', () => {
      const emptyConfigs = {
        serviceConfigs: {},
      };

      const result = StatusPageSettingsSchema.safeParse(emptyConfigs);
      expect(result.success).toBe(true);
    });

    it('should validate allowedCustomFields array', () => {
      const validFields = {
        allowedCustomFields: ['field1', 'field2', 'field3'],
      };

      const result = StatusPageSettingsSchema.safeParse(validFields);
      expect(result.success).toBe(true);
    });

    it('should accept empty allowedCustomFields array', () => {
      const emptyFields = {
        allowedCustomFields: [],
      };

      const result = StatusPageSettingsSchema.safeParse(emptyFields);
      expect(result.success).toBe(true);
    });

    // New tests for uptime thresholds
    describe('uptime thresholds', () => {
      it('should validate uptimeExcellentThreshold within range', () => {
        const validData = {
          uptimeExcellentThreshold: 99.9,
        };
        const result = StatusPageSettingsSchema.safeParse(validData);
        expect(result.success).toBe(true);
      });

      it('should validate uptimeGoodThreshold within range', () => {
        const validData = {
          uptimeGoodThreshold: 99.0,
        };
        const result = StatusPageSettingsSchema.safeParse(validData);
        expect(result.success).toBe(true);
      });

      it('should reject uptimeExcellentThreshold above 100', () => {
        const invalidData = {
          uptimeExcellentThreshold: 100.1,
        };
        const result = StatusPageSettingsSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      });

      it('should reject uptimeGoodThreshold below 0', () => {
        const invalidData = {
          uptimeGoodThreshold: -1,
        };
        const result = StatusPageSettingsSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      });

      it('should accept edge values 0 and 100', () => {
        const zeroThreshold = { uptimeGoodThreshold: 0 };
        const hundredThreshold = { uptimeExcellentThreshold: 100 };

        expect(StatusPageSettingsSchema.safeParse(zeroThreshold).success).toBe(true);
        expect(StatusPageSettingsSchema.safeParse(hundredThreshold).success).toBe(true);
      });
    });

    // Tests for empty string handling (contact info fix)
    describe('empty string handling', () => {
      it('should transform empty contactEmail to undefined', () => {
        const data = {
          contactEmail: '',
        };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.contactEmail).toBeUndefined();
        }
      });

      it('should transform empty contactUrl to undefined', () => {
        const data = {
          contactUrl: '',
        };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.contactUrl).toBeUndefined();
        }
      });

      it('should preserve valid contactEmail', () => {
        const data = {
          contactEmail: 'test@example.com',
        };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.contactEmail).toBe('test@example.com');
        }
      });

      it('should preserve valid contactUrl', () => {
        const data = {
          contactUrl: 'https://example.com',
        };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.contactUrl).toBe('https://example.com');
        }
      });

      it('should trim whitespace from contactEmail', () => {
        const data = {
          contactEmail: '  test@example.com  ',
        };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.contactEmail).toBe('test@example.com');
        }
      });
    });

    // Tests for boolean fields
    describe('boolean fields', () => {
      it('should accept explicit false for enabled', () => {
        const data = { enabled: false };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.enabled).toBe(false);
        }
      });

      it('should accept explicit false for showServices', () => {
        const data = { showServices: false };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.showServices).toBe(false);
        }
      });

      it('should accept all privacy boolean fields', () => {
        const data = {
          showIncidentDetails: false,
          showIncidentTitles: false,
          showIncidentDescriptions: false,
          showAffectedServices: false,
          showIncidentTimestamps: false,
          showServiceMetrics: false,
          showServiceDescriptions: false,
          showServiceRegions: false,
          showServicesByRegion: true,
          showServiceOwners: true,
          showServiceSlaTier: true,
          showTeamInformation: true,
          showCustomFields: true,
          showIncidentAssignees: true,
          showIncidentUrgency: false,
          showUptimeHistory: false,
          showRecentIncidents: false,
          showChangelog: false,
          showRegionHeatmap: false,
          showPostIncidentReview: false,
        };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
      });
    });

    // Tests for Status API settings
    describe('Status API settings', () => {
      it('should validate statusApiRateLimitMax range', () => {
        const validData = { statusApiRateLimitMax: 500 };
        expect(StatusPageSettingsSchema.safeParse(validData).success).toBe(true);

        const tooLow = { statusApiRateLimitMax: 0 };
        expect(StatusPageSettingsSchema.safeParse(tooLow).success).toBe(false);

        const tooHigh = { statusApiRateLimitMax: 10001 };
        expect(StatusPageSettingsSchema.safeParse(tooHigh).success).toBe(false);
      });

      it('should validate statusApiRateLimitWindowSec range', () => {
        const validData = { statusApiRateLimitWindowSec: 60 };
        expect(StatusPageSettingsSchema.safeParse(validData).success).toBe(true);

        const tooLow = { statusApiRateLimitWindowSec: 5 };
        expect(StatusPageSettingsSchema.safeParse(tooLow).success).toBe(false);

        const tooHigh = { statusApiRateLimitWindowSec: 86401 };
        expect(StatusPageSettingsSchema.safeParse(tooHigh).success).toBe(false);
      });

      it('should accept status API boolean settings', () => {
        const data = {
          statusApiRequireToken: true,
          statusApiRateLimitEnabled: true,
          enableUptimeExports: true,
        };
        const result = StatusPageSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('StatusAnnouncementCreateSchema', () => {
    it('should validate valid announcement', () => {
      const validData = {
        statusPageId: 'page-123',
        title: 'Maintenance Window',
        message: 'We will be performing scheduled maintenance',
        type: 'MAINTENANCE',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-02T00:00:00Z',
        isActive: true,
      };

      const result = StatusAnnouncementCreateSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate minimal announcement', () => {
      const minimalData = {
        statusPageId: 'page-123',
        title: 'Announcement',
        message: 'Message',
        startDate: '2024-01-01',
      };

      const result = StatusAnnouncementCreateSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
    });

    it('should reject empty statusPageId', () => {
      const invalidData = {
        statusPageId: '',
        title: 'Title',
        message: 'Message',
        startDate: '2024-01-01',
      };

      const result = StatusAnnouncementCreateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty title', () => {
      const invalidData = {
        statusPageId: 'page-123',
        title: '',
        message: 'Message',
        startDate: '2024-01-01',
      };

      const result = StatusAnnouncementCreateSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should validate title max length', () => {
      const tooLong = {
        statusPageId: 'page-123',
        title: 'a'.repeat(201),
        message: 'Message',
        startDate: '2024-01-01',
      };

      const result = StatusAnnouncementCreateSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it('should validate message max length', () => {
      const tooLong = {
        statusPageId: 'page-123',
        title: 'Title',
        message: 'a'.repeat(5001),
        startDate: '2024-01-01',
      };

      const result = StatusAnnouncementCreateSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it('should accept null endDate', () => {
      const dataWithNullEndDate = {
        statusPageId: 'page-123',
        title: 'Title',
        message: 'Message',
        startDate: '2024-01-01',
        endDate: null,
      };

      const result = StatusAnnouncementCreateSchema.safeParse(dataWithNullEndDate);
      expect(result.success).toBe(true);
    });
  });

  describe('StatusAnnouncementPatchSchema', () => {
    it('should validate valid patch', () => {
      const validData = {
        id: 'announcement-123',
        title: 'Updated Title',
        message: 'Updated message',
        isActive: false,
      };

      const result = StatusAnnouncementPatchSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate minimal patch with just id', () => {
      const minimalData = {
        id: 'announcement-123',
      };

      const result = StatusAnnouncementPatchSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
    });

    it('should reject empty id', () => {
      const invalidData = {
        id: '',
        title: 'Title',
      };

      const result = StatusAnnouncementPatchSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should validate title max length in patch', () => {
      const tooLong = {
        id: 'announcement-123',
        title: 'a'.repeat(201),
      };

      const result = StatusAnnouncementPatchSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it('should validate message max length in patch', () => {
      const tooLong = {
        id: 'announcement-123',
        message: 'a'.repeat(5001),
      };

      const result = StatusAnnouncementPatchSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });
  });
});
