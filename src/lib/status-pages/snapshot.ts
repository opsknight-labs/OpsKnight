import 'server-only';
import { IncidentEventType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { statusPagePublicationLimits } from './publication-policy';
import {
  incidentDetailCutoff,
  publicStatusVisibility,
  serializePublicStatusIncident,
} from '@/lib/status-page-public-data';
import { getReportingWindowForDays } from '@/lib/retention-policy';
import {
  addOperationalMetric,
  observeOperationalHistogram,
  setOperationalGauge,
} from '@/lib/metrics/operational/registry';
import {
  getStatusPageServingStore,
  manifestServingState,
  statusSnapshotIntegrity,
  type StatusServingRoute,
} from './serving-store';
import type { PublicStatusPageSnapshot } from './public-contract';
import { aggregatePublicRegions } from './history';
import {
  buildServiceHealthSegments,
  clipHealthSegments,
  effectiveIncidentEnd,
  healthAt,
  healthSegmentsToPublic,
  serviceAvailability,
} from './availability-engine';
import { projectPublicBranding, projectPublicPresentation } from './branding';
import { publicUptimeGrade } from './presentation';
import { deriveOverallPublicHealth, getWorstPublicStatus } from './status-presentation';
import { parsePublicStatusPageSnapshot } from './public-contract-schema';
import {
  changelogDisplayWhere,
  currentAnnouncementDisplayWhere,
  maintenanceInProgressDisplayWhere,
  maintenanceUpcomingDisplayWhere,
  mergeDisplayMaintenance,
  STATUS_PAGE_DISPLAY_FEED_LIMIT,
} from './display-feeds';
import {
  loadCurrentIncidentsByService,
  loadHistoryIncidentsByService,
  type HistoryIncident,
} from './history-query';

export type StatusPageSnapshot = PublicStatusPageSnapshot;

function mapMaintenanceRows(
  rows: Array<{ startDate: Date; endDate: Date | null; affectedServiceIds: unknown }>
) {
  return rows.map(item => ({
    startDate: item.startDate,
    endDate: item.endDate,
    affectedServiceIds: Array.isArray(item.affectedServiceIds)
      ? item.affectedServiceIds.filter((value): value is string => typeof value === 'string')
      : [],
  }));
}

function currentHealthWindowStart(
  incidents: HistoryIncident[],
  maintenance: Array<{ startDate: Date }>,
  now: Date
): Date {
  let earliest = now.getTime() - 1;
  for (const incident of incidents) {
    earliest = Math.min(earliest, incident.createdAt.getTime());
  }
  for (const item of maintenance) {
    earliest = Math.min(earliest, item.startDate.getTime());
  }
  return new Date(earliest);
}

function parseStatusPageSnapshot(
  pageId: string,
  payload: Prisma.JsonValue | null | undefined
): StatusPageSnapshot | null {
  return parsePublicStatusPageSnapshot(pageId, payload);
}

/** All public data is explicitly projected; no Prisma records are spread into the payload. */
export async function buildStatusPageSnapshot(
  pageId: string,
  revision: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<StatusPageSnapshot | null> {
  const page = await db.statusPage.findUnique({
    where: { id: pageId },
    include: {
      services: {
        where: { showOnPage: true },
        orderBy: { order: 'asc' },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              description: true,
              region: true,
              slaTier: true,
              team: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!page?.enabled) return null;

  const now = new Date();
  const limits = statusPagePublicationLimits(page);
  const visibility = publicStatusVisibility(page);
  const ids = page.services.map(mapping => mapping.serviceId);
  const [window, window30, window90] = await Promise.all([
    getReportingWindowForDays(limits.historyDays, 'incident', now),
    getReportingWindowForDays(30, 'incident', now),
    getReportingWindowForDays(90, 'incident', now),
  ]);
  const earliestRequiredStart = new Date(
    Math.min(window.start.getTime(), window90.start.getTime())
  );
  const DISPLAY_FEED_SELECT = {
    id: true,
    title: true,
    message: true,
    type: true,
    startDate: true,
    endDate: true,
    affectedServiceIds: true,
    createdAt: true,
    updatedAt: true,
  } as const;
  const loadDisplayFeed = (
    where: Prisma.StatusPageAnnouncementWhereInput,
    orderBy: { startDate: 'asc' | 'desc' }
  ) =>
    db.statusPageAnnouncement.findMany({
      where,
      orderBy,
      take: STATUS_PAGE_DISPLAY_FEED_LIMIT,
      select: DISPLAY_FEED_SELECT,
    });
  const needsHistory = visibility.showUptime;
  const maintenanceSelect = { startDate: true, endDate: true, affectedServiceIds: true } as const;
  const currentMaintenanceWhere = {
    statusPageId: pageId,
    type: 'MAINTENANCE' as const,
    isActive: true,
    startDate: { lte: now },
    OR: [{ endDate: { gte: now } }, { endDate: null }],
  };
  const historicalMaintenanceWhere = {
    statusPageId: pageId,
    type: 'MAINTENANCE' as const,
    isActive: true,
    startDate: { lte: now },
    OR: [{ endDate: { gte: earliestRequiredStart } }, { endDate: null }],
  };
  const emptyHistory = new Map<string, HistoryIncident[]>();
  // Interactive transactions cannot run queries in parallel; Promise.all here rolls the
  // publish lease back with "Transaction already closed".
  const currentIncidentsByService = ids.length
    ? await loadCurrentIncidentsByService(ids, db)
    : emptyHistory;
  const PUBLIC_EVENT_TYPES: IncidentEventType[] = [
    IncidentEventType.ACKNOWLEDGED,
    IncidentEventType.AUTO_RESOLVED,
    IncidentEventType.MANUAL_RESOLVED,
    IncidentEventType.REOPENED,
  ];
  const INCIDENT_SELECT: Prisma.IncidentSelect = {
    id: true,
    title: true,
    description: true,
    status: true,
    urgency: true,
    createdAt: true,
    acknowledgedAt: true,
    resolvedAt: true,
    updatedAt: true,
    service: { select: { id: true, name: true, region: true } },
    events: {
      where: { type: { in: PUBLIC_EVENT_TYPES } },
      orderBy: { createdAt: 'asc' },
      take: 8,
      select: { id: true, type: true, createdAt: true },
    },
    postmortem: {
      select: {
        id: true,
        status: true,
        isPublic: true,
        publishedAt: true,
        title: true,
        summary: true,
      },
    },
  };

  // Active incidents must never be evicted by the historical display limit.
  // We fetch ALL active PUBLIC incidents plus recent/overlapping resolved incidents
  // up to the display budget, then dedupe and sort active-first.
  type SnapshotIncident = Prisma.IncidentGetPayload<{ select: typeof INCIDENT_SELECT }>;
  let incidents: SnapshotIncident[] = [];
  if (ids.length && visibility.showIncidents) {
    const activeIncidents = await db.incident.findMany({
      where: {
        serviceId: { in: ids },
        visibility: 'PUBLIC',
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: INCIDENT_SELECT,
    });
    const historicalIncidents = await db.incident.findMany({
      where: {
        serviceId: { in: ids },
        visibility: 'PUBLIC',
        OR: [
          { createdAt: { gte: window.start, lte: now } },
          {
            createdAt: { lt: window.start },
            OR: [
              { resolvedAt: { gte: window.start } },
              { resolvedAt: null, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
              { resolvedAt: null, status: 'RESOLVED', updatedAt: { gte: window.start } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limits.maxIncidents,
      select: INCIDENT_SELECT,
    });
    const seen = new Set(activeIncidents.map(i => i.id));
    const dedupedHistorical = historicalIncidents.filter(i => !seen.has(i.id));
    const activeFirst = (a: SnapshotIncident, b: SnapshotIncident) => {
      const aActive = a.status === 'OPEN' || a.status === 'ACKNOWLEDGED' ? 0 : 1;
      const bActive = b.status === 'OPEN' || b.status === 'ACKNOWLEDGED' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const t = b.createdAt.getTime() - a.createdAt.getTime();
      if (t !== 0) return t;
      return b.id.localeCompare(a.id);
    };
    incidents = [...activeIncidents, ...dedupedHistorical].sort(activeFirst);
    // Trim historical overflow while preserving all active incidents
    if (incidents.length > activeIncidents.length + limits.maxIncidents) {
      const active = incidents.filter(i => i.status === 'OPEN' || i.status === 'ACKNOWLEDGED');
      const resolved = incidents.filter(i => !(i.status === 'OPEN' || i.status === 'ACKNOWLEDGED'));
      incidents = [...active, ...resolved.slice(0, limits.maxIncidents)];
    }
  }
  const historyIncidentsByService =
    ids.length && needsHistory
      ? await loadHistoryIncidentsByService(ids, earliestRequiredStart, now, db)
      : emptyHistory;
  const currentMaintenanceRows = await db.statusPageAnnouncement.findMany({
    where: currentMaintenanceWhere,
    select: maintenanceSelect,
  });
  const historyMaintenanceRows = needsHistory
    ? await db.statusPageAnnouncement.findMany({
        where: historicalMaintenanceWhere,
        select: maintenanceSelect,
      })
    : [];
  const displayAnnouncements = await loadDisplayFeed(currentAnnouncementDisplayWhere(pageId, now), {
    startDate: 'desc',
  });
  const maintenanceInProgressRows = await loadDisplayFeed(
    maintenanceInProgressDisplayWhere(pageId, now),
    { startDate: 'desc' }
  );
  const maintenanceUpcomingRows = await loadDisplayFeed(
    maintenanceUpcomingDisplayWhere(pageId, now),
    { startDate: 'asc' }
  );
  const changelogRows = page.showChangelog
    ? await loadDisplayFeed(changelogDisplayWhere(pageId, now), { startDate: 'desc' })
    : [];

  const impactByService = new Map<string, number>();
  for (const [serviceId, serviceIncidents] of currentIncidentsByService) {
    impactByService.set(serviceId, serviceIncidents.length);
  }

  const measuredDays30 = (now.getTime() - window30.start.getTime()) / 86_400_000;
  const measuredDays90 = (now.getTime() - window90.start.getTime()) / 86_400_000;
  const currentMaintenance = mapMaintenanceRows(currentMaintenanceRows);
  const maintenanceHistory = mapMaintenanceRows(
    needsHistory ? historyMaintenanceRows : currentMaintenanceRows
  );
  const uptimeWindowStarts = { days30: window30.start, days90: window90.start };
  const gradeThresholds = {
    excellent: page.uptimeExcellentThreshold,
    good: page.uptimeGoodThreshold,
  };
  const parseRegions = (region: string | null | undefined) =>
    (region ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  const servicePublicRefById = new Map(
    page.services.map(mapping => {
      const regions = parseRegions(mapping.service.region);
      return [
        mapping.serviceId,
        {
          id: mapping.serviceId,
          name: mapping.displayName || mapping.service.name,
          ...(page.showServiceRegions && regions.length ? { regions } : {}),
        },
      ] as const;
    })
  );
  const services = page.services.map(mapping => {
    const serviceHistoryIncidents = historyIncidentsByService.get(mapping.serviceId) ?? [];
    const serviceCurrentIncidents = currentIncidentsByService.get(mapping.serviceId) ?? [];
    const currentSegments = buildServiceHealthSegments({
      serviceId: mapping.serviceId,
      incidents: serviceCurrentIncidents,
      maintenance: currentMaintenance,
      start: currentHealthWindowStart(serviceCurrentIncidents, currentMaintenance, now),
      end: now,
    });
    const historySegments = needsHistory
      ? buildServiceHealthSegments({
          serviceId: mapping.serviceId,
          incidents: serviceHistoryIncidents,
          maintenance: maintenanceHistory,
          start: earliestRequiredStart,
          end: now,
        })
      : currentSegments;
    const currentHealth = healthAt(currentSegments, now.getTime());
    const recovered = needsHistory ? healthAt(historySegments, now.getTime()) : currentHealth;
    const historyCoverage = window.isClipped ? ('PARTIAL' as const) : ('COMPLETE' as const);
    const history = needsHistory
      ? {
          rangeStart: window.start.toISOString(),
          rangeEnd: now.toISOString(),
          coverage: historyCoverage,
          segments: healthSegmentsToPublic(clipHealthSegments(historySegments, window.start, now)),
        }
      : undefined;
    const status = currentHealth.status;
    const statusSince =
      status === 'OPERATIONAL' ? recovered.statusSince : currentHealth.statusSince;
    const availability30 = needsHistory
      ? serviceAvailability(historySegments, uptimeWindowStarts.days30, now)
      : null;
    const availability90 = needsHistory
      ? serviceAvailability(historySegments, uptimeWindowStarts.days90, now)
      : null;
    const uptime30Percentage = availability30?.percentage ?? null;
    const uptime90Percentage = availability90?.percentage ?? null;
    const uptime90Grade = visibility.showUptime
      ? publicUptimeGrade(uptime90Percentage, gradeThresholds)
      : undefined;
    const slaTier = visibility.showServiceSlaTier ? mapping.service.slaTier : null;
    const sla =
      slaTier || uptime90Grade
        ? {
            ...(slaTier ? { tier: slaTier } : {}),
            ...(uptime90Grade ? { grade: uptime90Grade } : {}),
          }
        : undefined;
    const publishedRegions = servicePublicRefById.get(mapping.serviceId)?.regions;
    return {
      id: mapping.serviceId,
      name: mapping.displayName || mapping.service.name,
      ...(page.showServiceDescriptions ? { description: mapping.service.description } : {}),
      ...(publishedRegions ? { regions: publishedRegions } : {}),
      ...(visibility.showServiceSlaTier ? { slaTier: mapping.service.slaTier } : {}),
      ...(sla ? { sla } : {}),
      ...(visibility.showTeam ? { team: mapping.service.team } : {}),
      status,
      ...(statusSince ? { statusSince } : {}),
      activeIncidentCount: impactByService.get(mapping.serviceId) ?? 0,
      ...(visibility.showUptime
        ? {
            uptime: {
              days30: {
                percentage: uptime30Percentage,
                incidentCount: serviceHistoryIncidents.filter(item => {
                  const closedAt = effectiveIncidentEnd(item) ?? now;
                  return item.createdAt <= now && closedAt >= window30.start;
                }).length,
                measuredDays: Math.min(30, measuredDays30),
                complete: measuredDays30 >= 30 && (availability30?.unknownMs ?? 0) === 0,
                ...(publicUptimeGrade(uptime30Percentage, gradeThresholds)
                  ? { grade: publicUptimeGrade(uptime30Percentage, gradeThresholds) }
                  : {}),
              },
              days90: {
                percentage: uptime90Percentage,
                incidentCount: serviceHistoryIncidents.filter(item => {
                  const closedAt = effectiveIncidentEnd(item) ?? now;
                  return item.createdAt <= now && closedAt >= window90.start;
                }).length,
                measuredDays: Math.min(90, measuredDays90),
                complete: measuredDays90 >= 90 && (availability90?.unknownMs ?? 0) === 0,
                ...(uptime90Grade ? { grade: uptime90Grade } : {}),
              },
            },
            history,
          }
        : {}),
    };
  });

  const affectedServiceRefs = (value: unknown) => {
    if (!Array.isArray(value)) return undefined;
    const refs = value
      .filter((id): id is string => typeof id === 'string')
      .map(id => servicePublicRefById.get(id))
      .filter((ref): ref is { id: string; name: string; regions?: string[] } => Boolean(ref));
    return refs.length ? refs.map(ref => ({ id: ref.id, name: ref.name })) : undefined;
  };
  const affectedRegionsFromIds = (value: unknown) => {
    if (!page.showServiceRegions || !page.showAffectedServices || !Array.isArray(value)) {
      return undefined;
    }
    const names = new Set<string>();
    for (const id of value) {
      if (typeof id !== 'string') continue;
      for (const region of servicePublicRefById.get(id)?.regions ?? []) names.add(region);
    }
    return names.size ? [...names].sort() : undefined;
  };
  const maintenanceState = (
    start: Date,
    end: Date | null
  ): 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' =>
    end && end <= now ? 'COMPLETED' : start <= now ? 'IN_PROGRESS' : 'SCHEDULED';

  const mapMaintenanceCard = (item: (typeof maintenanceInProgressRows)[number]) => {
    const affected = page.showAffectedServices
      ? affectedServiceRefs(item.affectedServiceIds)
      : undefined;
    const affectedRegions = affectedRegionsFromIds(item.affectedServiceIds);
    return {
      id: item.id,
      title: item.title,
      ...(item.message ? { description: item.message } : {}),
      state: maintenanceState(item.startDate, item.endDate),
      startAt: item.startDate.toISOString(),
      endAt: item.endDate ? item.endDate.toISOString() : null,
      ...(affected ? { affectedServices: affected } : {}),
      ...(affectedRegions ? { affectedRegions } : {}),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  };
  const maintenanceEntries = mergeDisplayMaintenance(
    maintenanceInProgressRows,
    maintenanceUpcomingRows
  ).map(mapMaintenanceCard);

  const changelog = page.showChangelog
    ? changelogRows.map(item => {
        const affected = page.showAffectedServices
          ? affectedServiceRefs(item.affectedServiceIds)
          : undefined;
        return {
          id: item.id,
          title: item.title,
          message: item.message,
          publishedAt: item.startDate.toISOString(),
          ...(affected ? { affectedServices: affected } : {}),
        };
      })
    : undefined;

  const visibleServices = visibility.showServices ? services : [];
  const overallBase = deriveOverallPublicHealth(visibleServices);
  const impactedServiceCount = visibleServices.filter(
    service => service.status !== 'OPERATIONAL' && service.status !== 'UNKNOWN'
  ).length;
  const activeIncidentTotal = visibleServices.reduce(
    (sum, service) => sum + (service.activeIncidentCount ?? 0),
    0
  );
  // overall.maintenanceCount must not under-report when >200 simultaneous
  // maintenances exist: display feeds are truncated (STATUS_PAGE_DISPLAY_FEED_LIMIT).
  const inProgressMaintenance = await db.statusPageAnnouncement.count({
    where: maintenanceInProgressDisplayWhere(pageId, now),
  });

  const lastIncidentUpdateAt = incidents.reduce<Date | null>((latest, incident) => {
    const times = [
      incident.createdAt,
      ...(incident.events?.map((event: { createdAt: Date }) => event.createdAt) ?? []),
    ];
    for (const time of times) {
      if (time && (!latest || time > latest)) latest = time;
    }
    return latest;
  }, null);

  const lastStatusChangeAt = visibleServices.reduce<string | undefined>((latest, service) => {
    if (!service.statusSince) return latest;
    return !latest || service.statusSince > latest ? service.statusSince : latest;
  }, undefined);

  const branding = projectPublicBranding(page.branding);
  const presentation = projectPublicPresentation(branding);
  const availableHistoryDays = Math.max(
    0,
    Math.round((now.getTime() - window.start.getTime()) / 86_400_000)
  );

  return {
    schemaVersion: 3,
    pageId,
    revision,
    generatedAt: now.toISOString(),
    page: {
      id: page.id,
      name: page.name,
      organizationName: page.organizationName,
      branding,
      ...(presentation ? { presentation } : {}),
      capabilities: {
        services: true,
        serviceHistory: true,
        uptime: true,
        regions: true,
        incidents: true,
        incidentUpdates: true,
        postmortems: true,
        maintenance: true,
        announcements: true,
        changelog: true,
        subscriptions: true,
        rss: true,
        jsonApi: true,
        uptimeCsv: true,
        uptimePdf: true,
      },
      resources: {
        jsonApi: true,
        rss: true,
        uptimeCsv: page.enableUptimeExports,
        uptimePdf: page.enableUptimeExports,
        postmortems: page.showPostIncidentReview,
        subscriptions: page.showSubscribe,
      },
      subscription: {
        enabled: page.showSubscribe,
        channels: ['EMAIL'],
        verificationRequired: true,
        serviceSelectionSupported: true,
      },
      showSubscribe: page.showSubscribe,
      showServicesByRegion: page.showServicesByRegion,
      showRegionHeatmap: page.showRegionHeatmap,
      showPostIncidentReview: page.showPostIncidentReview,
      showChangelog: page.showChangelog,
      visibility: {
        services: visibility.showServices,
        incidents: visibility.showIncidents,
        metrics: page.showMetrics,
        uptime: visibility.showUptime,
        regions: visibility.showServices && page.showServiceRegions,
        changelog: page.showChangelog,
        subscribe: page.showSubscribe,
      },
      enableUptimeExports: page.enableUptimeExports,
      footerText: page.footerText,
      contactEmail: page.contactEmail,
      contactUrl: page.contactUrl,
      slug: page.slug,
      customDomain: page.customDomain,
      subdomain: page.subdomain,
      isDefault: page.isDefault,
      requireAuth: page.requireAuth,
      enabled: page.enabled,
      statusApiRequireToken: page.statusApiRequireToken,
      statusApiRateLimitEnabled: page.statusApiRateLimitEnabled,
      statusApiRateLimitMax: page.statusApiRateLimitMax,
      statusApiRateLimitWindowSec: page.statusApiRateLimitWindowSec,
    },
    // Canonical page status matches overall severity. UNKNOWN is confidence, not a worse outage.
    status: overallBase.status,
    statusIncludingUnknown: visibleServices.length
      ? getWorstPublicStatus(visibleServices.map(service => service.status))
      : overallBase.status,
    overall: {
      ...overallBase,
      totalServiceCount: visibleServices.length,
      impactedServiceCount,
      activeIncidentCount: activeIncidentTotal,
      maintenanceCount: inProgressMaintenance,
    },
    thresholds: {
      uptimeExcellent: page.uptimeExcellentThreshold,
      uptimeGood: page.uptimeGoodThreshold,
    },
    services: visibleServices,
    regions: visibility.showServices ? aggregatePublicRegions(services) : [],
    incidents: (() => {
      // Perf: precompute once — avoids Date + clamp per incident in the hot loop.
      const detailCutoffMs = incidentDetailCutoff(
        page as unknown as Parameters<typeof incidentDetailCutoff>[0],
        now.getTime()
      );
      return incidents.map(incident =>
        serializePublicStatusIncident(
          incident,
          page as unknown as Parameters<typeof serializePublicStatusIncident>[1],
          { pageId, now, detailCutoffMs }
        )
      );
    })(),
    ...(maintenanceEntries.length ? { maintenance: maintenanceEntries } : {}),
    announcements: displayAnnouncements.map(item => {
      const affected = page.showAffectedServices
        ? affectedServiceRefs(item.affectedServiceIds)
        : undefined;
      const affectedRegions = affectedRegionsFromIds(item.affectedServiceIds);
      return {
        id: item.id,
        title: item.title,
        message: item.message,
        type: item.type,
        startDate: item.startDate.toISOString(),
        endDate: item.endDate?.toISOString() ?? null,
        ...(affected ? { affectedServices: affected } : {}),
        ...(affectedRegions ? { affectedRegions } : {}),
      };
    }),
    ...(changelog ? { changelog } : {}),
    retention: {
      requestedHistoryDays: limits.historyDays,
      availableHistoryDays,
      rangeStart: window.start.toISOString(),
      rangeEnd: now.toISOString(),
      coverage: window.isClipped ? ('PARTIAL' as const) : ('COMPLETE' as const),
    },
    freshness: {
      generatedAt: now.toISOString(),
      ...(lastStatusChangeAt ? { lastStatusChangeAt } : {}),
      ...(lastIncidentUpdateAt ? { lastIncidentUpdateAt: lastIncidentUpdateAt.toISOString() } : {}),
      revision,
    },
    historyDays: limits.historyDays,
  };
}

/**
 * What a publish attempt actually did.
 *
 * Callers need to tell "the page is now live" from "someone else is already publishing it", so
 * that a save racing the background projector is not reported to an administrator as a failure.
 */
export type StatusPagePublishOutcome =
  /** The snapshot was built, committed and pushed to the serving store. */
  | { kind: 'published'; revision: string }
  /** The page is disabled, so there is deliberately nothing to serve. */
  | { kind: 'disabled'; revision: string }
  /** Another builder holds the lease. It will finish the work; nothing is wrong. */
  | { kind: 'contended' }
  /** The revision moved under us. A later build already covers this change. */
  | { kind: 'superseded' }
  /** Building or publishing threw. The previous payload is untouched. */
  | { kind: 'failed'; error: unknown };

export type StatusPagePublishOptions = {
  /** Lease attempts before reporting contention. Each attempt uses its own transaction. */
  lockAttempts?: number;
  lockRetryDelayMs?: number;
  /** Wall-clock budget, also applied server-side via statement_timeout. */
  budgetMs?: number;
};

const DEFAULT_PUBLISH_BUDGET_MS = 30_000;
const DEFAULT_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

function snapshotByteLimit() {
  const configured = Number(process.env.STATUS_PAGE_SNAPSHOT_MAX_BYTES);
  // A malformed environment setting must not silently remove the guardrail. The upper bound is
  // deliberately finite: a public snapshot is an API response, not an archival transport.
  if (!Number.isFinite(configured)) return DEFAULT_SNAPSHOT_MAX_BYTES;
  return Math.max(256 * 1024, Math.min(20 * 1024 * 1024, Math.floor(configured)));
}

/** A PostgreSQL lease prevents simultaneous builders; revision CAS rejects a stale build. */
export async function rebuildStatusPageSnapshot(pageId: string) {
  const outcome = await publishStatusPageSnapshot(pageId);
  return outcome.kind === 'published';
}

/**
 * Build and publish one page, reporting precisely what happened.
 *
 * Ordering is load-bearing throughout: the commit happens in a single transaction so a partial
 * write cannot be observed, and the store receives snapshot, then manifest, then routes, so a
 * manifest never points at a body that is not yet readable and a route never resolves to a page
 * with no manifest.
 */
export async function publishStatusPageSnapshot(
  pageId: string,
  options: StatusPagePublishOptions = {}
): Promise<StatusPagePublishOutcome> {
  const budgetMs = Math.max(1_000, options.budgetMs ?? DEFAULT_PUBLISH_BUDGET_MS);
  const attempts = Math.max(1, options.lockAttempts ?? 1);
  const retryDelayMs = Math.max(0, options.lockRetryDelayMs ?? 50);
  const deadline = Date.now() + budgetMs;
  const publicationStartedAt = Date.now();

  for (let attempt = 0; attempt < attempts; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { kind: 'contended' };
    let result: Awaited<ReturnType<typeof buildAndCommitSnapshot>>;
    try {
      result = await buildAndCommitSnapshot(pageId, remainingMs);
    } catch (error) {
      return { kind: 'failed', error };
    }
    if (result === 'contended') {
      // Retry in a fresh transaction rather than holding one open, so a busy page never pins a
      // pooled connection while it waits.
      if (attempt + 1 < attempts && retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
      continue;
    }
    if (result === 'superseded') return { kind: 'superseded' };
    if (result === 'missing') {
      // No control row: the page was deleted between resolving it and building it.
      return { kind: 'failed', error: new Error(`No snapshot row for status page ${pageId}`) };
    }
    if (!result.snapshot) return { kind: 'disabled', revision: result.revision };
    try {
      const storeStartedAt = Date.now();
      await pushSnapshotToServingStore(pageId, result.revision, result.snapshot);
      observeOperationalHistogram(
        'opsknight_status_page_snapshot_build_duration_seconds',
        (Date.now() - storeStartedAt) / 1_000,
        { phase: 'serving_store' }
      );
    } catch (error) {
      // The database candidate is already committed at this point. Persist the store error here
      // so reconciliation retries it on its next pass instead of waiting for the age-based
      // refresh interval. This does not revoke the last good manifest or weaken fail-closed
      // privacy decisions; it only makes the retry observable and prompt.
      await recordSnapshotPublicationError(pageId, error);
      return { kind: 'failed', error };
    }
    observeOperationalHistogram(
      'opsknight_status_page_snapshot_build_duration_seconds',
      (Date.now() - publicationStartedAt) / 1_000,
      { phase: 'total' }
    );
    return { kind: 'published', revision: result.revision };
  }
  return { kind: 'contended' };
}

async function buildAndCommitSnapshot(
  pageId: string,
  remainingMs: number
): Promise<
  'contended' | 'missing' | 'superseded' | { snapshot: StatusPageSnapshot | null; revision: string }
> {
  const lease = await acquireSnapshotBuildLease(pageId, remainingMs);
  if (lease === 'contended' || lease === 'missing') return lease;
  const startedAt = Date.now();
  try {
    // The bounded read transaction gives the candidate a consistent source view and enforces the
    // server-side statement timeout. It deliberately holds no writer lock or build lease
    // transaction while history and uptime are calculated.
    const snapshot = await prisma.$transaction(
      async tx => {
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = ${Math.max(1_000, Math.floor(remainingMs))}`
        );
        return buildStatusPageSnapshot(pageId, lease.revision.toString(), tx);
      },
      { timeout: Math.max(1_000, Math.floor(remainingMs)) }
    );
    observeOperationalHistogram(
      'opsknight_status_page_snapshot_build_duration_seconds',
      (Date.now() - startedAt) / 1_000,
      { phase: 'read' }
    );
    if (snapshot) {
      const bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
      setOperationalGauge('opsknight_status_page_snapshot_bytes', bytes);
      const maxBytes = snapshotByteLimit();
      if (bytes > maxBytes) {
        throw new Error(
          `Status snapshot is ${bytes} bytes, exceeding the ${maxBytes}-byte publication limit.`
        );
      }
    }
    const commitStartedAt = Date.now();
    const committed = await commitSnapshotCandidate(pageId, lease, snapshot);
    observeOperationalHistogram(
      'opsknight_status_page_snapshot_build_duration_seconds',
      (Date.now() - commitStartedAt) / 1_000,
      { phase: 'commit' }
    );
    if (!committed) {
      // A source write advanced the revision while the candidate was being built. The lease is
      // still ours, so clear it before returning: the newer revision can start immediately
      // instead of waiting for this bounded lease to expire.
      await releaseSnapshotBuildLease(pageId, lease.token);
      return 'superseded';
    }
    return { snapshot, revision: lease.revision.toString() };
  } catch (error) {
    await releaseSnapshotBuildLease(pageId, lease.token);
    throw error;
  }
}

type SnapshotBuildLease = { token: string; revision: bigint };

async function acquireSnapshotBuildLease(
  pageId: string,
  remainingMs: number
): Promise<SnapshotBuildLease | 'contended' | 'missing'> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(10_000, Math.min(60_000, remainingMs + 5_000)));
  const rows = await prisma.$queryRaw<Array<{ revision: bigint }>>`
    UPDATE "StatusPageSnapshot"
    SET "buildLeaseToken" = ${token}, "buildLeaseExpiresAt" = ${expiresAt}
    WHERE "statusPageId" = ${pageId}
      AND ("buildLeaseToken" IS NULL OR "buildLeaseExpiresAt" < NOW())
    RETURNING "revision"
  `;
  if (rows[0]) return { token, revision: rows[0].revision };
  const exists = await prisma.statusPageSnapshot.findUnique({
    where: { statusPageId: pageId },
    select: { statusPageId: true },
  });
  return exists ? 'contended' : 'missing';
}

async function commitSnapshotCandidate(
  pageId: string,
  lease: SnapshotBuildLease,
  snapshot: StatusPageSnapshot | null
): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    UPDATE "StatusPageSnapshot"
    SET "payload" = ${snapshot ? JSON.stringify(snapshot) : null}::jsonb,
      "publishedRevision" = ${lease.revision}, "generatedAt" = NOW(), "lastError" = NULL,
      "servingState" = ${snapshot ? 'LIVE' : 'DISABLED'},
      "buildLeaseToken" = NULL, "buildLeaseExpiresAt" = NULL
    WHERE "statusPageId" = ${pageId} AND "revision" = ${lease.revision}
      AND "buildLeaseToken" = ${lease.token} AND "buildLeaseExpiresAt" >= NOW()
  `;
  return Number(changed) === 1;
}

async function releaseSnapshotBuildLease(pageId: string, token: string) {
  await prisma.$executeRaw`
    UPDATE "StatusPageSnapshot"
    SET "buildLeaseToken" = NULL, "buildLeaseExpiresAt" = NULL
    WHERE "statusPageId" = ${pageId} AND "buildLeaseToken" = ${token}
  `;
}

async function recordSnapshotPublicationError(pageId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await prisma.$executeRaw`
    UPDATE "StatusPageSnapshot"
       SET "lastError" = ${message}
     WHERE "statusPageId" = ${pageId}
  `;
}

async function pushSnapshotToServingStore(
  pageId: string,
  revision: string,
  snapshot: StatusPageSnapshot
) {
  const store = getStatusPageServingStore();
  const result = { snapshot, revision };
  await store.publishSnapshot(
    pageId,
    result.revision,
    result.snapshot as unknown as Prisma.JsonValue
  );
  await store.publishManifest({
    pageId,
    revision: result.revision,
    enabled: true,
    revoked: false,
    snapshotKey: `${result.revision}.json`,
    publishedAt: result.snapshot.generatedAt,
    schemaVersion: result.snapshot.schemaVersion,
    integrityHash: statusSnapshotIntegrity(result.snapshot as unknown as Prisma.JsonValue),
    servingState: 'LIVE',
    lastGoodRevision: result.revision,
    lastGoodSnapshotKey: `${result.revision}.json`,
    lastGoodIntegrityHash: statusSnapshotIntegrity(result.snapshot as unknown as Prisma.JsonValue),
  });
  const slug = result.snapshot.page?.slug;
  const route: StatusServingRoute = {
    pageId,
    slug: slug ?? null,
    requireAuth: result.snapshot.page.requireAuth,
    revision: result.revision,
  };
  if (slug) await store.publishRoute(slug, route);
  if (result.snapshot.page?.isDefault) await store.publishRoute('default', route);
  if (result.snapshot.page.customDomain) {
    await store.publishRoute(`domain:${result.snapshot.page.customDomain.toLowerCase()}`, route);
  }
  if (result.snapshot.page.subdomain) {
    await store.publishRoute(`subdomain:${result.snapshot.page.subdomain.toLowerCase()}`, route);
  }
}

/** Bounded reconciliation also advances maintenance boundaries and time-derived uptime. */
export async function reconcileStatusPageSnapshots(limit = 10) {
  const [health] = await prisma.$queryRaw<
    Array<{
      dirty: bigint;
      oldestAgeSeconds: number | null;
      failed: bigint;
      failClosed: bigint;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "publishedRevision" <> "revision") AS "dirty",
      EXTRACT(EPOCH FROM (NOW() - MIN("generatedAt")))::double precision AS "oldestAgeSeconds",
      COUNT(*) FILTER (WHERE "lastError" IS NOT NULL) AS "failed",
      COUNT(*) FILTER (WHERE "servingState" = 'FAIL_CLOSED') AS "failClosed"
    FROM "StatusPageSnapshot"
  `;
  setOperationalGauge('opsknight_status_page_snapshot_dirty', Number(health?.dirty ?? 0));
  setOperationalGauge(
    'opsknight_status_page_snapshot_oldest_age_seconds',
    Math.max(0, health?.oldestAgeSeconds ?? 0)
  );
  // The two alerting signals: a publication that keeps failing, and a page currently withheld
  // from the public. Either persisting is an operator problem, not a transient.
  setOperationalGauge('opsknight_status_page_publication_failed', Number(health?.failed ?? 0));
  setOperationalGauge('opsknight_status_page_fail_closed', Number(health?.failClosed ?? 0));

  const pages = await prisma.$queryRaw<
    Array<{ statusPageId: string; dirty: boolean; servingState: string }>
  >`
    SELECT "statusPageId", "servingState", ("publishedRevision" <> "revision") AS "dirty"
    FROM "StatusPageSnapshot"
    WHERE "publishedRevision" <> "revision"
       OR "lastError" IS NOT NULL
       OR "generatedAt" < NOW() - INTERVAL '1 minute'
    ORDER BY "generatedAt" ASC NULLS FIRST LIMIT ${Math.max(1, Math.min(50, limit))}
  `;
  let rebuilt = 0;
  for (const page of pages) {
    try {
      // A dirty revision of unknown provenance may represent disclosure tightening and must
      // fail closed. A row already carrying a non-LIVE state holds a decision the control plane
      // made deliberately, and overwriting it here would flap the page dark between an
      // administrator's commit and its synchronous republish.
      if (page.dirty && page.servingState === 'LIVE') {
        await getStatusPageServingStore().revoke(page.statusPageId, 'PRIVACY');
      }
      const outcome = await publishStatusPageSnapshot(page.statusPageId);
      if (outcome.kind === 'failed') {
        const message = (
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
        ).slice(0, 500);
        await prisma.$executeRaw`UPDATE "StatusPageSnapshot" SET "lastError" = ${message} WHERE "statusPageId" = ${page.statusPageId}`;
        addOperationalMetric('opsknight_status_page_snapshot_rebuild_total', 1, {
          outcome: 'failure',
        });
      } else if (outcome.kind === 'published' || outcome.kind === 'disabled') {
        rebuilt++;
        addOperationalMetric('opsknight_status_page_snapshot_rebuild_total', 1, {
          outcome: 'success',
        });
      }
    } catch {
      addOperationalMetric('opsknight_status_page_snapshot_rebuild_total', 1, {
        outcome: 'failure',
      });
      await prisma.$executeRaw`UPDATE "StatusPageSnapshot" SET "lastError" = 'Projection failed; retry pending' WHERE "statusPageId" = ${page.statusPageId}`;
    }
  }
  return { attempted: pages.length, rebuilt };
}

export async function readStatusPageSnapshot(pageId: string): Promise<StatusPageSnapshot | null> {
  const rows = await prisma.$queryRaw<Array<{ payload: Prisma.JsonValue }>>`
    SELECT "payload" FROM "StatusPageSnapshot" WHERE "statusPageId" = ${pageId}
  `;
  return parseStatusPageSnapshot(pageId, rows[0]?.payload);
}

/**
 * Return a sanitized projection, preferring the current revision.
 *
 * When the current revision is not servable, the previous one is used only if the control plane
 * marked the invalidation as benign. That marker is written exclusively by a configuration change
 * classified as non-tightening, so every disclosure-narrowing transition -- a tightened setting, a
 * disabled page, or any invalidation of unknown provenance, including the database triggers that
 * cannot classify themselves -- leaves the marker fail-closed and withholds everything.
 *
 * The fallback body is safe to show because it is a previously published projection, already
 * sanitized under a disclosure policy at least as broad as the one now in force. The access gate
 * cannot be weakened this way either: raising `requireAuth` classifies as tightening and fails
 * closed, while lowering it can only leave a stale `true` behind, which merely over-prompts.
 */
export async function getStatusPageSnapshot(pageId: string): Promise<{
  snapshot: StatusPageSnapshot | null;
  stale: boolean;
  servingState: 'LIVE' | 'STALE_OK' | 'FAIL_CLOSED' | 'DISABLED' | 'UNCONFIGURED';
}> {
  const store = getStatusPageServingStore();
  const manifest = await store.readManifest(pageId);
  if (!manifest) return { snapshot: null, stale: true, servingState: 'UNCONFIGURED' };
  const recordedServingState = manifestServingState(manifest);
  // Database triggers can invalidate a revision without knowing whether the underlying write
  // broadened or narrowed disclosure. A manifest still labelled LIVE is therefore only live
  // while it is internally consistent; an unexplained revocation must fail closed.
  const servingState =
    recordedServingState === 'LIVE' && manifest.revoked ? 'FAIL_CLOSED' : recordedServingState;

  if (manifest.enabled && !manifest.revoked) {
    const payload = await store.readSnapshot(pageId, manifest.revision);
    if (payload && statusSnapshotIntegrity(payload) === manifest.integrityHash) {
      const current = parseStatusPageSnapshot(pageId, payload);
      if (current) return { snapshot: current, stale: false, servingState };
    }
  }

  if (servingState === 'STALE_OK') {
    const lastGood = await store.readLastGoodSnapshot(pageId);
    const previous = lastGood ? parseStatusPageSnapshot(pageId, lastGood.payload) : null;
    if (previous) {
      addOperationalMetric('opsknight_status_page_stale_serves_total', 1, { surface: 'snapshot' });
      return { snapshot: previous, stale: true, servingState };
    }
  }

  return { snapshot: null, stale: true, servingState };
}

export async function getStatusPageSnapshotByRoute(routeKey: string) {
  const store = getStatusPageServingStore();
  const route = await store.resolveRoute(routeKey || 'default');
  return route
    ? { pageId: route.pageId, ...(await getStatusPageSnapshot(route.pageId)) }
    : { pageId: null, snapshot: null, stale: true, servingState: 'UNCONFIGURED' as const };
}
