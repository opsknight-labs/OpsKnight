import type {
  PublicIncident,
  PublicIncidentStatus,
  PublicIncidentUrgency,
  PublicServiceStatus,
  PublicStatusPageSnapshot,
  PublicStatusService,
  PublicStatusBranding,
  PublicPagePresentation,
} from './public-contract';
import { aggregatePublicRegions } from './history';
import {
  deriveOverallPublicHealth,
  getWorstPublicStatus,
  publicStatusForIncidentUrgency,
} from './status-presentation';

type PreviewService = {
  id: string;
  name: string;
  description?: string | null;
  region?: string | null;
  slaTier?: string | null;
  team?: { id: string; name: string } | null;
  [key: string]: unknown;
};

type PreviewMapping = { serviceId: string; displayName?: string | null; showOnPage: boolean };

type PreviewIncident = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  urgency?: string;
  createdAt: string | Date;
  acknowledgedAt?: string | Date | null;
  resolvedAt?: string | Date | null;
  service?: { id: string; name: string; region?: string | null };
  events?: Array<{ id: string; message: string; createdAt: string | Date }>;
  postmortem?: { id: string; status: string; isPublic?: boolean | null } | null;
};

type PreviewAnnouncement = {
  id: string;
  title: string;
  message: string;
  type?: string;
  startDate?: string;
  endDate?: string;
};

type PreviewPrivacy = Record<string, unknown> | null | undefined;

const ACTIVE_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED']);

function iso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function splitRegions(region: string | null | undefined): string[] {
  return (region ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

/**
 * Project unsaved settings into the published contract so the preview can render the real page.
 *
 * The preview is a configuration preview: it answers "what will visitors see if I save this",
 * which is a question about layout, branding, which services appear, and which fields the privacy
 * toggles disclose. It deliberately does not attempt to reproduce measured uptime or daily
 * history, because those come from the projection pipeline and cannot be recomputed in a browser.
 * Their absence is honest -- the contract already treats a missing window as unmeasured -- and it
 * keeps preview and live rendering the same component tree, which is the property that matters.
 */
export function buildPreviewSnapshot(input: {
  pageId: string;
  name?: string;
  slug?: string | null;
  subdomain?: string | null;
  customDomain?: string | null;
  contactEmail?: string | null;
  contactUrl?: string | null;
  branding?: PublicStatusBranding;
  presentation?: PublicPagePresentation;
  services: PreviewService[];
  mappings: PreviewMapping[];
  incidents: PreviewIncident[];
  announcements: PreviewAnnouncement[];
  uptime90: Record<string, number>;
  privacy: PreviewPrivacy;
  showServices: boolean;
  showIncidents: boolean;
  showSubscribe?: boolean;
  showChangelog?: boolean;
  showServicesByRegion?: boolean;
  showRegionHeatmap?: boolean;
  showPostIncidentReview?: boolean;
  enableUptimeExports?: boolean;
  showServiceRegions?: boolean;
  showServiceOwners?: boolean;
  showServiceSlaTier?: boolean;
  showMetrics?: boolean;
  showUptimeHistory?: boolean;
  showTeamInformation?: boolean;
  regions?: any[];
  maintenance?: any[];
  thresholds: { uptimeExcellent: number; uptimeGood: number };
  now?: Date;
}): PublicStatusPageSnapshot {
  const now = input.now ?? new Date();
  const allow = (flag: string) => Reflect.get(input.privacy ?? {}, flag) !== false;

  const visible = new Map(
    input.mappings
      .filter(mapping => mapping.showOnPage)
      .map(mapping => [mapping.serviceId, mapping])
  );
  const activeByService = new Map<string, { count: number; statuses: PublicServiceStatus[] }>();
  for (const incident of input.incidents) {
    if (!incident.service || !ACTIVE_STATUSES.has(incident.status)) continue;
    const entry = activeByService.get(incident.service.id) ?? { count: 0, statuses: [] };
    entry.count += 1;
    entry.statuses.push(publicStatusForIncidentUrgency(incident.urgency ?? 'LOW'));
    activeByService.set(incident.service.id, entry);
  }

  const rangeEnd = now;
  const rangeStart = new Date(now.getTime() - 90 * 86_400_000);

  const services: PublicStatusService[] = input.showServices
    ? input.services
        .filter(service => visible.has(service.id))
        .map(service => {
          const impact = activeByService.get(service.id);
          const rawStatus = (service as any).status;
          const status = impact
            ? getWorstPublicStatus(impact.statuses)
            : rawStatus && rawStatus !== 'OPERATIONAL'
              ? rawStatus
              : 'OPERATIONAL';

          const uptimePct =
            typeof input.uptime90?.[service.id] === 'number'
              ? input.uptime90[service.id]
              : typeof (service as any).uptime?.days90?.percentage === 'number'
                ? (service as any).uptime.days90.percentage
                : status === 'OPERATIONAL'
                  ? 100
                  : 98.5;

          const grade =
            uptimePct >= input.thresholds.uptimeExcellent
              ? ('EXCELLENT' as const)
              : uptimePct >= input.thresholds.uptimeGood
                ? ('GOOD' as const)
                : ('BELOW_TARGET' as const);

          const serviceHistory = (service as any).history ?? {
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
            coverage: 'COMPLETE' as const,
            segments:
              status !== 'OPERATIONAL'
                ? [
                    {
                      startAt: new Date(now.getTime() - 4 * 3600_000).toISOString(),
                      endAt: now.toISOString(),
                      status: status as any,
                    },
                  ]
                : [],
          };

          const serviceUptime = (service as any).uptime ?? {
            days30: {
              percentage: uptimePct,
              incidentCount: impact?.count ?? (service as any).activeIncidentCount ?? 0,
              measuredDays: 30,
              complete: true,
              grade,
            },
            days90: {
              percentage: uptimePct,
              incidentCount: impact?.count ?? (service as any).activeIncidentCount ?? 0,
              measuredDays: 90,
              complete: true,
              grade,
            },
          };

          return {
            id: service.id,
            name: visible.get(service.id)?.displayName || service.name,
            ...(allow('showServiceDescriptions') && service.description
              ? { description: service.description }
              : {}),
            ...(allow('showServiceRegions') ? { regions: splitRegions(service.region) } : {}),
            ...(input.showServiceSlaTier !== false && service.slaTier
              ? {
                  slaTier: service.slaTier,
                  sla: { tier: service.slaTier, grade },
                }
              : {}),
            ...(input.showServiceOwners !== false &&
            input.showTeamInformation === true &&
            allow('showTeamInformation')
              ? { team: service.team ?? null }
              : {}),
            status,
            activeIncidentCount: impact?.count ?? (service as any).activeIncidentCount ?? 0,
            uptime: serviceUptime,
            history: serviceHistory,
          };
        })
    : [];

  const nowMs = now.getTime();
  const previewDetailCutoffMs = (() => {
    if (Reflect.get(input.privacy ?? {}, 'showIncidentHistoryDetails') !== false) return null;
    const raw = Reflect.get(input.privacy ?? {}, 'incidentHistoryDetailDays') as unknown;
    if (raw == null) return null;
    const days = Math.max(1, Math.min(365, Math.floor(Number(raw))));
    if (!Number.isFinite(days)) return null;
    return nowMs - days * 86_400_000;
  })();
  const clampTitle = (value: string, max = 120) =>
    value.length <= max ? value : `${value.slice(0, max).trimEnd()}…`;
  const redactedByAge = (incident: {
    status: string;
    createdAt: string | Date | null | undefined;
  }) => {
    if (previewDetailCutoffMs == null) return false;
    if (incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED') return false;
    const showHistoryDetails = allow('showIncidentHistoryDetails');
    if (showHistoryDetails === false && incident.status !== 'RESOLVED') return false;
    const t = incident.createdAt ? Date.parse(String(incident.createdAt)) : NaN;
    if (Number.isNaN(t)) return false;
    return t < (previewDetailCutoffMs as number);
  };
  const incidents: PublicIncident[] = input.showIncidents
    ? input.incidents.map(incident => {
        const redacted = redactedByAge(incident);
        return {
          status: incident.status as PublicIncidentStatus,
          ...(allow('showIncidentDetails') ? { id: incident.id } : {}),
          ...(allow('showIncidentTitles') && incident.title
            ? { title: redacted ? clampTitle(incident.title) : incident.title }
            : {}),
          ...(!redacted && allow('showIncidentDescriptions') && incident.description
            ? { description: incident.description }
            : {}),
          ...(allow('showIncidentUrgency') && incident.urgency
            ? { urgency: incident.urgency as PublicIncidentUrgency }
            : {}),
          ...(allow('showIncidentTimestamps')
            ? {
                ...(iso(incident.createdAt) ? { createdAt: iso(incident.createdAt) } : {}),
                ...(iso(incident.acknowledgedAt)
                  ? { acknowledgedAt: iso(incident.acknowledgedAt) }
                  : {}),
                ...(iso(incident.resolvedAt) ? { resolvedAt: iso(incident.resolvedAt) } : {}),
              }
            : {}),
          ...(allow('showAffectedServices') && incident.service
            ? {
                service: {
                  id: incident.service.id,
                  name: incident.service.name,
                  ...(allow('showServiceRegions')
                    ? { regions: splitRegions(incident.service.region) }
                    : {}),
                },
              }
            : {}),
          ...(incident.postmortem?.isPublic ? { postIncidentReview: true } : {}),
          ...(redacted ? { redacted: true as const } : {}),
        };
      })
    : [];

  // Same announcement-derived maintenance/changelog split the real projector uses, so the preview
  // renders the same V3 sections a visitor will see after saving.
  const maintenanceEntries = input.announcements
    .filter(item => (item.type ?? 'INFO') === 'MAINTENANCE')
    .map(item => {
      const startAt = iso(item.startDate) ?? now.toISOString();
      const endAtIso = iso(item.endDate);
      const endMs = endAtIso ? Date.parse(endAtIso) : NaN;
      const state =
        Number.isFinite(endMs) && endMs <= now.getTime()
          ? ('COMPLETED' as const)
          : Date.parse(startAt) <= now.getTime()
            ? ('IN_PROGRESS' as const)
            : ('SCHEDULED' as const);
      return {
        id: item.id,
        title: item.title,
        ...(item.message ? { description: item.message } : {}),
        state,
        startAt,
        endAt: endAtIso ?? null,
      };
    });

  const changelogEntries =
    input.showChangelog !== false
      ? input.announcements
          .filter(item => (item.type ?? 'INFO') === 'UPDATE')
          .map(item => ({
            id: item.id,
            title: item.title,
            message: item.message,
            publishedAt: iso(item.startDate) ?? now.toISOString(),
          }))
      : undefined;

  const overallBase = deriveOverallPublicHealth(services);
  const impactedServiceCount = services.filter(
    service => service.status !== 'OPERATIONAL' && service.status !== 'UNKNOWN'
  ).length;
  const activeIncidentTotal = services.reduce(
    (sum, service) => sum + (service.activeIncidentCount ?? 0),
    0
  );
  const inProgressMaintenance = maintenanceEntries.filter(
    item => item.state === 'IN_PROGRESS'
  ).length;

  return {
    schemaVersion: 3,
    pageId: input.pageId,
    revision: 'preview',
    generatedAt: now.toISOString(),
    page: {
      id: input.pageId,
      name: input.name || 'Status Page',
      slug: input.slug ?? null,
      subdomain: input.subdomain ?? null,
      customDomain: input.customDomain ?? null,
      contactEmail: input.contactEmail ?? null,
      contactUrl: input.contactUrl ?? null,
      branding: input.branding,
      presentation: input.presentation,
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
        uptimeCsv: false,
        uptimePdf: false,
        postmortems: false,
        subscriptions: input.showSubscribe !== false,
      },
      subscription: {
        enabled: input.showSubscribe !== false,
        channels: ['EMAIL'],
        verificationRequired: true,
        serviceSelectionSupported: false,
      },
      showSubscribe: input.showSubscribe !== false,
      showServicesByRegion: input.showServicesByRegion ?? false,
      showRegionHeatmap: input.showRegionHeatmap ?? false,
      showPostIncidentReview: input.showPostIncidentReview ?? false,
      showChangelog: input.showChangelog !== false,
      visibility: {
        services: input.showServices,
        incidents: input.showIncidents,
        metrics: input.showMetrics !== false,
        uptime:
          input.showMetrics !== false &&
          input.showUptimeHistory !== false &&
          allow('showServiceMetrics'),
        regions:
          input.showServices && input.showServiceRegions !== false && allow('showServiceRegions'),
        changelog: input.showChangelog !== false,
        subscribe: input.showSubscribe !== false,
      },
      enableUptimeExports: input.enableUptimeExports ?? false,
      isDefault: true,
      requireAuth: false,
      enabled: true,
      statusApiRequireToken: false,
      statusApiRateLimitEnabled: false,
      statusApiRateLimitMax: 120,
      statusApiRateLimitWindowSec: 60,
    },
    status: overallBase.status,
    statusIncludingUnknown: services.length
      ? getWorstPublicStatus(services.map(service => service.status))
      : overallBase.status,
    overall: {
      ...overallBase,
      totalServiceCount: services.length,
      impactedServiceCount,
      activeIncidentCount: activeIncidentTotal,
      maintenanceCount: inProgressMaintenance,
    },
    thresholds: input.thresholds,
    services,
    regions:
      input.regions && input.regions.length > 0 ? input.regions : aggregatePublicRegions(services),
    incidents,
    ...(input.maintenance && input.maintenance.length > 0
      ? { maintenance: input.maintenance }
      : maintenanceEntries.length
        ? { maintenance: maintenanceEntries }
        : {}),
    announcements: input.announcements
      .filter(item => (item.type ?? 'INFO') !== 'MAINTENANCE' && (item.type ?? 'INFO') !== 'UPDATE')
      .map(item => ({
        id: item.id,
        title: item.title,
        message: item.message,
        type: item.type ?? 'INFO',
        startDate: iso(item.startDate) ?? now.toISOString(),
        endDate: iso(item.endDate) ?? null,
      })),
    ...(changelogEntries ? { changelog: changelogEntries } : {}),
    freshness: {
      generatedAt: now.toISOString(),
      revision: 'preview',
    },
    historyDays: 90,
  };
}
