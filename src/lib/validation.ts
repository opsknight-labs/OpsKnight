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

function isHostname(value: string): boolean {
  if (value === '') return true;
  if (value.length > 253 || value.includes('..')) return false;
  return value.split('.').every(label => {
    if (label.length < 1 || label.length > 63 || label.startsWith('-') || label.endsWith('-')) {
      return false;
    }
    for (const character of label.toLowerCase()) {
      if (!'abcdefghijklmnopqrstuvwxyz0123456789-'.includes(character)) return false;
    }
    return true;
  });
}

export function isStatusPageSlug(value: string): boolean {
  if (value.length < 1 || value.length > 80 || value.startsWith('-') || value.endsWith('-')) {
    return false;
  }
  for (const character of value) {
    if (!'abcdefghijklmnopqrstuvwxyz0123456789-'.includes(character)) return false;
  }
  return !value.includes('--');
}

const statusPageHostname = z.string().trim().max(253).refine(isHostname, 'Enter a valid hostname');

const statusPageAssetUrl = z
  .string()
  .trim()
  .max(2_800_000)
  .refine(
    value =>
      value === '' ||
      value.startsWith('/') ||
      value.startsWith('https://') ||
      value.startsWith('data:image/png;base64,') ||
      value.startsWith('data:image/jpeg;base64,') ||
      value.startsWith('data:image/webp;base64,') ||
      value.startsWith('data:image/gif;base64,'),
    'Use a relative path, HTTPS URL, or supported raster data image.'
  );

export const StatusPageBrandingSchema = z
  .object({
    version: z.literal(1).optional(),
    logoUrl: statusPageAssetUrl.optional(),
    logo: statusPageAssetUrl.optional(),
    faviconUrl: statusPageAssetUrl.optional(),
    primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    primary: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    backgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    background: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    textColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    text: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    fontFamily: z.string().trim().max(100).optional(),
    customCss: z.string().max(200_000).optional(),
    layout: z.enum(['default', 'compact', 'wide']).optional(),
    showHeader: z.boolean().optional(),
    showFooter: z.boolean().optional(),
    metaTitle: z.string().trim().max(200).optional(),
    metaDescription: z.string().trim().max(500).optional(),
    autoRefresh: z.boolean().optional(),
    refreshInterval: z.number().int().min(10).max(3600).optional(),
    showRssLink: z.boolean().optional(),
    showApiLink: z.boolean().optional(),
  })
  .passthrough();

export const StatusPageSettingsSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(isStatusPageSlug, 'Use lowercase letters, numbers, and single hyphens only.')
      .optional()
      .nullable(),
    isDefault: z.boolean().optional(),
    organizationName: z.string().trim().max(200).optional().nullable(),
    subdomain: statusPageHostname.optional().nullable(),
    customDomain: statusPageHostname.optional().nullable(),
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
    branding: StatusPageBrandingSchema.optional().nullable(),
    serviceIds: z
      .array(z.string().min(1))
      .max(10000)
      .optional()
      .transform(ids => (ids ? Array.from(new Set(ids)) : ids)),
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
  })
  .superRefine((data, ctx) => {
    if (
      data.uptimeExcellentThreshold !== undefined &&
      data.uptimeGoodThreshold !== undefined &&
      data.uptimeExcellentThreshold < data.uptimeGoodThreshold
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['uptimeExcellentThreshold'],
        message: 'Excellent uptime threshold must be greater than or equal to the good threshold.',
      });
    }
  });

export const StatusApiTokenCreateSchema = z.object({
  statusPageId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
});

export const StatusApiTokenRevokeSchema = z.object({
  id: z.string().min(1),
});

export const StatusAnnouncementCreateSchema = z
  .object({
    statusPageId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5000),
    type: z.string().trim().max(50).optional(),
    startDate: z.string().min(1),
    endDate: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    notifySubscribers: z.boolean().optional(),
    affectedServiceIds: z.array(z.string().min(1)).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.endDate && new Date(data.endDate).getTime() <= new Date(data.startDate).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date must be after start date.',
      });
    }
  });

export const StatusAnnouncementPatchSchema = z.object({
  id: z.string().min(1),
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
