import type {
  PublicIncident,
  PublicIncidentStatus,
  PublicIncidentUpdateType,
  PublicIncidentUrgency,
} from '@/lib/status-pages/public-contract';
import { publicStatusIncidentEventId } from '@/lib/status-pages/public-event-id';
import { publicStatusForIncidentUrgency } from '@/lib/status-pages/status-presentation';

export type StatusPagePublicSettings = {
  showServices: boolean;
  showIncidents: boolean;
  showMetrics: boolean;
  showIncidentDetails: boolean;
  showIncidentTitles: boolean;
  showIncidentDescriptions: boolean;
  showAffectedServices: boolean;
  showIncidentTimestamps: boolean;
  showServiceMetrics: boolean;
  showServiceRegions: boolean;
  showServiceOwners: boolean;
  showServiceSlaTier: boolean;
  showTeamInformation: boolean;
  showIncidentUrgency: boolean;
  showUptimeHistory: boolean;
  showRecentIncidents: boolean;
  showPostIncidentReview?: boolean;
  showIncidentHistoryDetails?: boolean;
  incidentHistoryDetailDays?: number | null;
};

export function publicStatusVisibility(settings: StatusPagePublicSettings) {
  const showIncidents = settings.showIncidents && settings.showRecentIncidents;
  const showMetrics = settings.showMetrics && settings.showServiceMetrics;

  return {
    showServices: settings.showServices,
    showIncidents,
    showMetrics,
    showUptime: showMetrics && settings.showUptimeHistory,
    showServiceRegion: settings.showServiceRegions,
    showServiceSlaTier: settings.showServiceSlaTier,
    showTeam: settings.showTeamInformation || settings.showServiceOwners,
    showIncidentId: settings.showIncidentDetails,
    showIncidentTitle: settings.showIncidentTitles,
    showIncidentDescription: settings.showIncidentDescriptions,
    showAffectedService: settings.showAffectedServices,
    showIncidentTimestamp: settings.showIncidentTimestamps,
    showIncidentUrgency: settings.showIncidentUrgency,
    showPostIncidentReview: settings.showPostIncidentReview === true,
  };
}

type PublicIncidentInput = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  urgency?: string;
  createdAt: string | Date;
  resolvedAt: string | Date | null;
  acknowledgedAt?: string | Date | null;
  service?: { id?: string; name?: string; region?: string | null } | null;
  postmortem?: {
    status?: string;
    isPublic?: boolean | null;
    publishedAt?: string | Date | null;
    title?: string | null;
    summary?: string | null;
  } | null;
  events?: Array<{
    id: string;
    type?: string | null;
    message: string;
    createdAt: string | Date;
  }>;
};

function serializeDate(value: string | Date | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function incidentDetailCutoffMs(settings: StatusPagePublicSettings, nowMs: number): number | null {
  if (settings.showIncidentHistoryDetails === false) return nowMs;
  const raw = settings.incidentHistoryDetailDays;
  if (raw == null) return null;
  const days = Math.max(1, Math.min(365, Math.floor(Number(raw))));
  if (!Number.isFinite(days)) return null;
  return nowMs - days * 86_400_000;
}

function shouldRedactByCutoff(
  createdAt: string | Date | null | undefined,
  cutoffMs: number | null
): boolean {
  if (cutoffMs == null) return false;
  if (!createdAt) return false;
  const ms = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  return Number.isFinite(ms) && (ms as number) < cutoffMs;
}

function truncateForRedacted(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

export function incidentDetailCutoff(settings: StatusPagePublicSettings, nowMs: number): number | null {
  return incidentDetailCutoffMs(settings, nowMs);
}

/** Shape every public endpoint from the same status-page visibility controls. */
export function serializePublicStatusIncident(
  incident: PublicIncidentInput,
  settings: StatusPagePublicSettings,
  context?: { pageId: string; now?: Date | string | number; detailCutoffMs?: number | null }
): PublicIncident {
  // Perf: allow callers batching many incidents to precompute the cutoff once.
  let cutoffMs: number | null;
  let now: Date;
  if (context?.detailCutoffMs !== undefined) {
    cutoffMs = context.detailCutoffMs;
    now = context.now == null ? new Date() : context.now instanceof Date ? context.now : new Date(context.now as string | number);
  } else {
    now = context?.now == null
      ? new Date()
      : context.now instanceof Date
        ? context.now
        : new Date(context.now as string | number);
    cutoffMs = incidentDetailCutoffMs(settings, now.getTime());
  }
  const redactedByAge = shouldRedactByCutoff(incident.createdAt, cutoffMs);
  const visibility = publicStatusVisibility(settings);
  const result: PublicIncident = { status: incident.status as PublicIncidentStatus };
  if (context?.pageId) {
    result.publicEventId = publicStatusIncidentEventId(context.pageId, incident.id);
  }

  if (visibility.showIncidentId) result.id = incident.id;
  if (visibility.showIncidentTitle && incident.title) {
    result.title = redactedByAge ? truncateForRedacted(incident.title) : incident.title;
  }
  if (!redactedByAge && visibility.showIncidentDescription && incident.description) {
    result.description = incident.description;
  }
  if (visibility.showIncidentUrgency && incident.urgency) {
    result.urgency = incident.urgency as PublicIncidentUrgency;
    const impact = publicStatusForIncidentUrgency(incident.urgency);
    if (impact !== 'OPERATIONAL' && impact !== 'MAINTENANCE') result.publicImpact = impact;
  }
  if (visibility.showIncidentTimestamp) {
    result.createdAt = serializeDate(incident.createdAt);
    const acknowledgedAt = serializeDate(incident.acknowledgedAt);
    const resolvedAt = serializeDate(incident.resolvedAt);
    if (acknowledgedAt) result.acknowledgedAt = acknowledgedAt;
    if (resolvedAt) result.resolvedAt = resolvedAt;
  }
  if (visibility.showAffectedService && incident.service) {
    result.service = {
      ...(incident.service.id ? { id: incident.service.id } : {}),
      ...(incident.service.name ? { name: incident.service.name } : {}),
      ...(visibility.showServiceRegion && incident.service.region
        ? {
            regions: incident.service.region
              .split(',')
              .map(value => value.trim())
              .filter(Boolean),
          }
        : {}),
    };
  }
  if (!redactedByAge && visibility.showIncidentId && visibility.showIncidentDescription && incident.events?.length) {
    // G01: cap + truncate updates so a long private thread cannot leak via detail window.
    result.updates = incident.events.slice(0, 8).map(event => ({
      id: event.id,
      type: publicUpdateType(event.type),
      message: truncateForRedacted(event.message, 400),
      ...(visibility.showIncidentTimestamp ? { createdAt: serializeDate(event.createdAt) } : {}),
    }));
  }
  if (
    visibility.showPostIncidentReview &&
    incident.status === 'RESOLVED' &&
    incident.postmortem?.status === 'PUBLISHED' &&
    incident.postmortem.isPublic !== false
  ) {
    result.postIncidentReview = true;
    if (visibility.showIncidentId && incident.id) {
      const publishedAt = serializeDate(incident.postmortem.publishedAt);
      result.postmortem = {
        available: true,
        id: incident.id,
        ...(publishedAt ? { publishedAt } : {}),
        ...(incident.postmortem.title ? { title: incident.postmortem.title } : {}),
        ...(incident.postmortem.summary ? { summary: incident.postmortem.summary } : {}),
      };
    }
  }

  if (redactedByAge) result.redacted = true;

  return result;
}

function publicUpdateType(type: string | null | undefined): PublicIncidentUpdateType {
  if (
    type === 'INVESTIGATING' ||
    type === 'IDENTIFIED' ||
    type === 'MONITORING' ||
    type === 'ACKNOWLEDGED' ||
    type === 'RESOLVED' ||
    type === 'UPDATE'
  ) {
    return type;
  }
  if (type === 'AUTO_RESOLVED' || type === 'MANUAL_RESOLVED') return 'RESOLVED';
  return 'UPDATE';
}

/**
 * Keep the long-standing `/api/status` incident shape while applying the
 * same visibility policy used by the other public status endpoints.
 */
export function serializePublicStatusApiIncident(
  incident: PublicIncidentInput,
  settings: StatusPagePublicSettings,
  context?: { pageId: string; now?: Date | string }
): Record<string, unknown> {
  const result = { ...serializePublicStatusIncident(incident, settings, context) } as Record<
    string,
    unknown
  >;
  const service = result.service;
  if (!service || typeof service !== 'object' || Array.isArray(service)) return result;

  const { service: _service, ...withoutService } = result;
  const publicService = service as { name?: unknown; regions?: unknown };
  return {
    ...withoutService,
    ...(typeof publicService.name === 'string' ? { service: publicService.name } : {}),
    ...('regions' in publicService ? { serviceRegions: publicService.regions } : {}),
  };
}
