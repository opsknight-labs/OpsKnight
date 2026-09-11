import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { PublicStatusPageSnapshot } from './public-contract';
import { aggregatePublicRegions } from './history';
import {
  deriveOverallPublicHealth,
  getWorstPublicStatus,
  normalizePublicStatus,
} from './status-presentation';

const status = z.enum([
  'OPERATIONAL',
  'DEGRADED',
  'MAINTENANCE',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
  'UNKNOWN',
]);
const dateTime = z.string().datetime({ offset: true });

const uptimeGrade = z.enum(['EXCELLENT', 'GOOD', 'BELOW_TARGET']);

const affectedServiceRef = z.object({ id: z.string(), name: z.string() }).passthrough();

const uptimeWindow = z
  .object({
    percentage: z.number().min(0).max(100).nullable(),
    incidentCount: z.number().int().nonnegative(),
    measuredDays: z.number().nonnegative(),
    complete: z.boolean(),
    grade: uptimeGrade.optional(),
  })
  .passthrough();

/**
 * Branding is validated leniently on purpose. Snapshots published before the typed contract stored
 * whatever the admin form produced (aliases like `primary`/`logo`); rejecting unknown keys here would
 * make those payloads unparseable and take the page dark. Typed keys are checked; extras pass through.
 */
const branding = z
  .object({
    logoUrl: z.string().optional(),
    faviconUrl: z.string().optional(),
    primaryColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
    fontFamily: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    customCss: z.string().optional(),
    layout: z.enum(['default', 'compact', 'wide']).optional(),
    showHeader: z.boolean().optional(),
    showFooter: z.boolean().optional(),
    autoRefresh: z.boolean().optional(),
    refreshInterval: z.number().optional(),
    showApiLink: z.boolean().optional(),
    showRssLink: z.boolean().optional(),
  })
  .passthrough();

const presentation = z
  .object({
    layout: z.enum(['default', 'compact', 'wide']).optional(),
    showHeader: z.boolean().optional(),
    showFooter: z.boolean().optional(),
    autoRefresh: z.boolean().optional(),
    refreshInterval: z.number().optional(),
    showApiLink: z.boolean().optional(),
    showRssLink: z.boolean().optional(),
  })
  .passthrough();

const capabilities = z
  .object({
    services: z.boolean(),
    serviceHistory: z.boolean(),
    uptime: z.boolean(),
    regions: z.boolean(),
    incidents: z.boolean(),
    incidentUpdates: z.boolean(),
    postmortems: z.boolean(),
    maintenance: z.boolean(),
    announcements: z.boolean(),
    changelog: z.boolean(),
    subscriptions: z.boolean(),
    rss: z.boolean(),
    jsonApi: z.boolean(),
    uptimeCsv: z.boolean(),
    uptimePdf: z.boolean(),
  })
  .passthrough();

const resources = z
  .object({
    jsonApi: z.boolean(),
    rss: z.boolean(),
    uptimeCsv: z.boolean(),
    uptimePdf: z.boolean(),
    postmortems: z.boolean(),
    subscriptions: z.boolean(),
  })
  .passthrough();

const subscriptionCapabilities = z
  .object({
    enabled: z.boolean(),
    channels: z.array(z.string()),
    verificationRequired: z.boolean(),
    serviceSelectionSupported: z.boolean(),
  })
  .passthrough();

const historySegment = z
  .object({
    startAt: dateTime,
    endAt: dateTime,
    status: status.exclude(['OPERATIONAL']),
  })
  .passthrough()
  .refine(segment => Date.parse(segment.startAt) < Date.parse(segment.endAt), {
    message: 'History segment end must follow its start',
  });

const incidentUpdate = z
  .object({
    id: z.string(),
    type: z.enum([
      'INVESTIGATING',
      'IDENTIFIED',
      'MONITORING',
      'ACKNOWLEDGED',
      'RESOLVED',
      'UPDATE',
    ]),
    message: z.string(),
    createdAt: dateTime.optional(),
  })
  .passthrough();

/**
 * Optional so payloads published before this field existed keep validating. The reader derives it
 * when absent; making it required would make every already-published snapshot unparseable, which
 * takes the public pages dark until the projector rewrites them.
 */
const overallHealth = z
  .object({
    status,
    statusSince: dateTime.optional(),
    knownServiceCount: z.number().int().nonnegative(),
    unknownServiceCount: z.number().int().nonnegative(),
    confidence: z.enum(['complete', 'partial', 'none']),
    totalServiceCount: z.number().int().nonnegative().optional(),
    impactedServiceCount: z.number().int().nonnegative().optional(),
    activeIncidentCount: z.number().int().nonnegative().optional(),
    maintenanceCount: z.number().int().nonnegative().optional(),
    headline: z.string(),
    note: z.string().nullable(),
  })
  .passthrough();

export const publicStatusPageSnapshotSchema = z
  .object({
    schemaVersion: z.literal(3),
    pageId: z.string(),
    revision: z.string(),
    generatedAt: dateTime,
    overall: overallHealth.optional(),
    thresholds: z
      .object({
        uptimeExcellent: z.number(),
        uptimeGood: z.number(),
      })
      .passthrough()
      .optional(),
    page: z
      .object({
        id: z.string(),
        name: z.string(),
        organizationName: z.string().nullable().optional(),
        branding: branding.nullable().optional(),
        presentation: presentation.optional(),
        capabilities: capabilities.optional(),
        resources: resources.optional(),
        subscription: subscriptionCapabilities.optional(),
        showSubscribe: z.boolean(),
        showServicesByRegion: z.boolean(),
        showRegionHeatmap: z.boolean(),
        showPostIncidentReview: z.boolean(),
        showChangelog: z.boolean(),
        visibility: z
          .object({
            services: z.boolean(),
            incidents: z.boolean(),
            metrics: z.boolean(),
            uptime: z.boolean(),
            regions: z.boolean(),
            changelog: z.boolean(),
            subscribe: z.boolean(),
          })
          .passthrough()
          .optional(),
        enableUptimeExports: z.boolean(),
        footerText: z.string().nullable().optional(),
        contactEmail: z.string().nullable().optional(),
        contactUrl: z.string().nullable().optional(),
        slug: z.string().nullable().optional(),
        customDomain: z.string().nullable().optional(),
        subdomain: z.string().nullable().optional(),
        isDefault: z.boolean(),
        requireAuth: z.boolean(),
        enabled: z.boolean(),
        statusApiRequireToken: z.boolean(),
        statusApiRateLimitEnabled: z.boolean(),
        statusApiRateLimitMax: z.number().int().positive(),
        statusApiRateLimitWindowSec: z.number().int().positive(),
      })
      .passthrough(),
    status,
    statusIncludingUnknown: status.optional(),
    services: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable().optional(),
          regions: z.array(z.string()).optional(),
          status,
          statusSince: dateTime.optional(),
          activeIncidentCount: z.number().int().nonnegative(),
          team: z.object({ id: z.string(), name: z.string() }).passthrough().nullable().optional(),
          slaTier: z.string().nullable().optional(),
          sla: z
            .object({
              tier: z.string().nullable().optional(),
              target: z.number().nullable().optional(),
              grade: uptimeGrade.optional(),
            })
            .passthrough()
            .optional(),
          uptime: z.object({ days30: uptimeWindow, days90: uptimeWindow }).passthrough().optional(),
          history: z
            .object({
              rangeStart: dateTime,
              rangeEnd: dateTime,
              coverage: z.enum(['COMPLETE', 'PARTIAL']),
              segments: z.array(historySegment),
            })
            .passthrough()
            .refine(history => Date.parse(history.rangeStart) < Date.parse(history.rangeEnd), {
              message: 'History range end must follow its start',
            })
            .optional(),
        })
        .passthrough()
    ),
    regions: z.array(
      z
        .object({
          name: z.string(),
          status,
          totalServices: z.number().int().nonnegative(),
          operationalServices: z.number().int().nonnegative(),
          degradedServices: z.number().int().nonnegative(),
          maintenanceServices: z.number().int().nonnegative(),
          partialOutageServices: z.number().int().nonnegative(),
          majorOutageServices: z.number().int().nonnegative(),
          unknownServices: z.number().int().nonnegative(),
          impactedServices: z.number().int().nonnegative(),
          serviceIds: z.array(z.string()),
        })
        .passthrough()
    ),
    incidents: z.array(
      z
        .object({
          id: z.string().optional(),
          publicEventId: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']),
          urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
          publicImpact: z
            .enum(['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'UNKNOWN'])
            .optional(),
          createdAt: dateTime.optional(),
          acknowledgedAt: dateTime.optional(),
          resolvedAt: dateTime.optional(),
          service: z
            .object({
              id: z.string().optional(),
              name: z.string().optional(),
              regions: z.array(z.string()).optional(),
            })
            .passthrough()
            .optional(),
          updates: z.array(incidentUpdate).optional(),
          postIncidentReview: z.boolean().optional(),
          postmortem: z
            .object({
              available: z.literal(true),
              id: z.string(),
              publishedAt: dateTime.optional(),
              title: z.string().optional(),
              summary: z.string().optional(),
            })
            .passthrough()
            .optional(),
          redacted: z.boolean().optional(),
        })
        .passthrough()
    ),
    maintenance: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            description: z.string().optional(),
            state: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED']),
            startAt: dateTime,
            endAt: dateTime.nullable().optional(),
            affectedServices: z.array(affectedServiceRef).optional(),
            affectedRegions: z.array(z.string()).optional(),
            createdAt: dateTime.optional(),
            updatedAt: dateTime.optional(),
          })
          .passthrough()
      )
      .optional(),
    announcements: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          message: z.string(),
          type: z.string(),
          startDate: dateTime,
          endDate: dateTime.nullable(),
          affectedServices: z.array(affectedServiceRef).optional(),
          affectedRegions: z.array(z.string()).optional(),
        })
        .passthrough()
    ),
    changelog: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            message: z.string(),
            publishedAt: dateTime,
            affectedServices: z.array(affectedServiceRef).optional(),
          })
          .passthrough()
      )
      .optional(),
    retention: z
      .object({
        requestedHistoryDays: z.number().int().positive(),
        availableHistoryDays: z.number().int().nonnegative(),
        rangeStart: dateTime,
        rangeEnd: dateTime,
        coverage: z.enum(['COMPLETE', 'PARTIAL']),
      })
      .passthrough()
      .optional(),
    freshness: z
      .object({
        generatedAt: dateTime,
        lastStatusChangeAt: dateTime.optional(),
        lastIncidentUpdateAt: dateTime.optional(),
        revision: z.string(),
      })
      .passthrough()
      .optional(),
    historyDays: z.number().int().positive(),
  })
  .passthrough();

export function parsePublicStatusPageSnapshot(
  pageId: string,
  payload: Prisma.JsonValue | null | undefined
): PublicStatusPageSnapshot | null {
  const parsed = publicStatusPageSnapshotSchema.safeParse(payload);
  if (parsed.success && parsed.data.pageId === pageId) {
    const overall = parsed.data.overall ?? deriveOverallPublicHealth(parsed.data.services);
    return {
      ...parsed.data,
      overall,
      status: overall.status,
      statusIncludingUnknown:
        parsed.data.statusIncludingUnknown ??
        getWorstPublicStatus(parsed.data.services.map(service => service.status)),
    } as PublicStatusPageSnapshot;
  }
  const legacy = legacySnapshotSchema.safeParse(payload);
  if (!legacy.success || legacy.data.pageId !== pageId) return null;
  const services = legacy.data.services.map(service => ({
    id: service.id,
    name: service.name,
    ...(service.description !== undefined ? { description: service.description } : {}),
    ...(service.region
      ? {
          regions: service.region
            .split(',')
            .map(value => value.trim())
            .filter(Boolean),
        }
      : {}),
    status: normalizePublicStatus(service.status),
    activeIncidentCount: service.activeIncidentCount ?? 0,
    ...(legacy.data.uptime || legacy.data.uptime30
      ? {
          uptime: {
            days30: {
              percentage: legacy.data.uptime30?.[service.id] ?? null,
              incidentCount: 0,
              measuredDays: 30,
              complete: true,
            },
            days90: {
              percentage: legacy.data.uptime?.[service.id] ?? null,
              incidentCount: 0,
              measuredDays: 90,
              complete: true,
            },
          },
        }
      : {}),
  }));
  const candidate = {
    schemaVersion: 3 as const,
    pageId,
    revision: legacy.data.revision,
    generatedAt: legacy.data.generatedAt,
    page: legacy.data.page,
    status: deriveOverallPublicHealth(services).status,
    statusIncludingUnknown: normalizePublicStatus(legacy.data.status),
    overall: deriveOverallPublicHealth(services),
    services,
    regions: aggregatePublicRegions(services),
    incidents: legacy.data.incidents.map(incident => ({
      status: incident.status,
      ...(incident.id ? { id: incident.id } : {}),
      ...(incident.title ? { title: incident.title } : {}),
      ...(incident.description ? { description: incident.description } : {}),
      ...(incident.urgency ? { urgency: incident.urgency } : {}),
      ...(incident.createdAt ? { createdAt: incident.createdAt } : {}),
      ...(incident.resolvedAt ? { resolvedAt: incident.resolvedAt } : {}),
      ...(incident.postIncidentReview ? { postIncidentReview: true } : {}),
      ...(incident.service
        ? {
            service: {
              ...(incident.service.name ? { name: incident.service.name } : {}),
              ...(incident.service.region
                ? {
                    regions: incident.service.region
                      .split(',')
                      .map(value => value.trim())
                      .filter(Boolean),
                  }
                : {}),
            },
          }
        : {}),
    })),
    announcements: legacy.data.announcements,
    historyDays: legacy.data.historyDays,
  };
  const migrated = publicStatusPageSnapshotSchema.safeParse(candidate);
  if (!migrated.success) return null;
  const overall = migrated.data.overall ?? deriveOverallPublicHealth(services);
  return {
    ...migrated.data,
    overall,
    status: overall.status,
    statusIncludingUnknown:
      migrated.data.statusIncludingUnknown ??
      getWorstPublicStatus(services.map(service => service.status)),
  } as PublicStatusPageSnapshot;
}

const legacySnapshotSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    pageId: z.string(),
    revision: z.string(),
    generatedAt: dateTime,
    status: z.string(),
    page: publicStatusPageSnapshotSchema.shape.page,
    services: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable().optional(),
          region: z.string().nullable().optional(),
          status: z.string(),
          activeIncidentCount: z.number().int().nonnegative().optional(),
        })
        .passthrough()
    ),
    incidents: z.array(
      z
        .object({
          id: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED']),
          urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
          createdAt: dateTime.optional(),
          resolvedAt: dateTime.nullable().optional(),
          service: z
            .object({ name: z.string().optional(), region: z.string().nullable().optional() })
            .optional(),
          postIncidentReview: z.boolean().optional(),
        })
        .passthrough()
    ),
    uptime: z.record(z.string(), z.number()).optional(),
    uptime30: z.record(z.string(), z.number()).optional(),
    announcements: publicStatusPageSnapshotSchema.shape.announcements,
    historyDays: z.number().int().positive(),
  })
  .passthrough();
