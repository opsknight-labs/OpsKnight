import { z } from 'zod';

// Email validation - RFC 5322 compliant
const _emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// URL validation
const _urlRegex =
  /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/;

// Custom validators
export const emailValidator = z
  .string()
  .trim()
  .email('Please enter a valid email address')
  .max(320);
export const urlValidator = z
  .string()
  .trim()
  .url('Please enter a valid URL starting with http:// or https://')
  .max(500)
  .optional()
  .nullable();
export const optionalUrlValidator = z
  .string()
  .trim()
  .url('Please enter a valid URL starting with http:// or https://')
  .max(500)
  .optional()
  .nullable();

export const IncidentCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).optional().nullable(),
  serviceId: z.string().min(1),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  priority: z.string().trim().max(20).optional().nullable(),
});

export const IncidentPatchSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']).optional(),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  assigneeId: z.string().max(100).optional().nullable(),
});

export const EventSchema = z.object({
  event_action: z.enum(['trigger', 'resolve', 'acknowledge']),
  dedup_key: z.string().trim().min(1).max(200),
  payload: z.object({
    summary: z.string().trim().min(1).max(500),
    source: z.string().trim().min(1).max(200),
    severity: z.enum(['critical', 'error', 'warning', 'info']),
    custom_details: z.unknown().optional(),
  }),
});

export const NotificationPatchSchema = z
  .object({
    markAllAsRead: z.boolean().optional(),
    notificationIds: z.array(z.string()).optional(),
  })
  .refine(data => data.markAllAsRead || (data.notificationIds && data.notificationIds.length > 0), {
    message: 'markAllAsRead or notificationIds is required',
  });

export const StatusPageSettingsSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  organizationName: z.string().trim().max(200).optional().nullable(),
  subdomain: z.string().trim().max(200).optional().nullable(),
  customDomain: z.string().trim().max(200).optional().nullable(),
  enabled: z.boolean().optional(),
  showServices: z.boolean().optional(),
  showIncidents: z.boolean().optional(),
  showMetrics: z.boolean().optional(),
  showSubscribe: z.boolean().optional(),
  uptimeExcellentThreshold: z.number().min(0).max(100).optional(),
  uptimeGoodThreshold: z.number().min(0).max(100).optional(),
  footerText: z.string().trim().max(1000).optional().nullable(),
  contactEmail: z
    .string()
    .trim()
    .transform(val => (val === '' ? undefined : val))
    .pipe(emailValidator.optional().nullable())
    .optional()
    .nullable(),
  contactUrl: z
    .string()
    .trim()
    .transform(val => (val === '' ? undefined : val))
    .pipe(z.string().url().optional().nullable())
    .optional()
    .nullable(),
  branding: z.unknown().optional().nullable(),
  serviceIds: z.array(z.string()).optional(),
  serviceConfigs: z
    .record(
      z.object({
        displayName: z.string().trim().max(200).optional().nullable(),
        order: z.number().int().optional(),
        showOnPage: z.boolean().optional(),
      })
    )
    .optional(),
  // Privacy settings
  privacyMode: z.enum(['PUBLIC', 'RESTRICTED', 'PRIVATE', 'CUSTOM']).optional().nullable(),
  showIncidentDetails: z.boolean().optional(),
  showIncidentTitles: z.boolean().optional(),
  showIncidentDescriptions: z.boolean().optional(),
  showAffectedServices: z.boolean().optional(),
  showIncidentTimestamps: z.boolean().optional(),
  showServiceMetrics: z.boolean().optional(),
  showServiceDescriptions: z.boolean().optional(),
  showServiceRegions: z.boolean().optional(),
  showServicesByRegion: z.boolean().optional(),
  showServiceOwners: z.boolean().optional(),
  showServiceSlaTier: z.boolean().optional(),
  showTeamInformation: z.boolean().optional(),
  showCustomFields: z.boolean().optional(),
  showIncidentAssignees: z.boolean().optional(),
  showIncidentUrgency: z.boolean().optional(),
  showUptimeHistory: z.boolean().optional(),
  showRecentIncidents: z.boolean().optional(),
  showChangelog: z.boolean().optional(),
  showRegionHeatmap: z.boolean().optional(),
  showPostIncidentReview: z.boolean().optional(),
  maxIncidentsToShow: z.number().int().min(1).max(500).optional(),
  incidentHistoryDays: z.number().int().min(1).max(365).optional(),
  allowedCustomFields: z.array(z.string()).optional().nullable(),
  dataRetentionDays: z.number().int().min(1).optional().nullable(),
  requireAuth: z.boolean().optional(),
  authProvider: z.string().optional().nullable(),
  emailProvider: z.string().optional().nullable(),
  enableUptimeExports: z.boolean().optional(),
  statusApiRequireToken: z.boolean().optional(),
  statusApiRateLimitEnabled: z.boolean().optional(),
  statusApiRateLimitMax: z.number().int().min(1).max(10000).optional(),
  statusApiRateLimitWindowSec: z.number().int().min(10).max(86400).optional(),
});

export const StatusApiTokenCreateSchema = z.object({
  statusPageId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
});

export const StatusApiTokenRevokeSchema = z.object({
  id: z.string().min(1),
  statusPageId: z.string().min(1),
});

export const StatusAnnouncementCreateSchema = z.object({
  statusPageId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  type: z.string().trim().max(50).optional(),
  startDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  notifySubscribers: z.boolean().optional(),
  affectedServiceIds: z.array(z.string().min(1)).optional().nullable(),
});

export const StatusAnnouncementPatchSchema = z.object({
  id: z.string().min(1),
  statusPageId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(5000).optional(),
  type: z.string().trim().max(50).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  affectedServiceIds: z.array(z.string().min(1)).optional().nullable(),
});

export const StatusAnnouncementDeleteSchema = z.object({
  id: z.string().min(1),
  statusPageId: z.string().min(1),
});

export const CustomFieldCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_]+$/),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN', 'URL', 'EMAIL']),
  required: z.boolean().optional(),
  defaultValue: z.string().optional().nullable(),
  options: z.unknown().optional().nullable(),
  showInList: z.boolean().optional(),
});

export const CustomFieldUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().optional().nullable(),
  options: z.unknown().optional().nullable(),
  showInList: z.boolean().optional(),
  order: z.number().int().optional(),
});

export const IncidentCustomFieldSchema = z.object({
  customFieldId: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().nullable(),
});
