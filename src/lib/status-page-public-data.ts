import type {
  PublicIncident,
  PublicIncidentStatus,
  PublicIncidentUpdate,
  PublicIncidentUrgency,
} from '@/lib/status-pages/public-contract';
import {
  publicStatusIncidentEventId,
  publicStatusIncidentUpdateEventId,
} from '@/lib/status-pages/public-event-id';
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

/**
 * IncidentEvent is an internal audit stream. Never forward its free-text message to the public
 * status page: assignment, escalation, Jira, notification, and responder identity details can be
 * embedded in those messages. Only lifecycle facts with customer-safe fixed copy are projected.
 */
function serializePublicIncidentUpdate(
  incidentId: string,
  event: NonNullable<PublicIncidentInput['events']>[number],
  pageId: string | undefined,
  showTimestamp: boolean
): PublicIncidentUpdate | null {
  let update: Pick<PublicIncidentUpdate, 'type' | 'message'> | null = null;
  switch (event.type) {
    case 'ACKNOWLEDGED':
      update = { type: 'ACKNOWLEDGED', message: 'We are investigating the issue.' };
      break;
    case 'AUTO_RESOLVED':
    case 'MANUAL_RESOLVED':
      update = { type: 'RESOLVED', message: 'This incident has been resolved.' };
      break;
    case 'REOPENED':
      update = { type: 'UPDATE', message: 'Incident reopened.' };
      break;
    default:
      return null;
  }

  return {
    id: publicStatusIncidentUpdateEventId(pageId ?? 'unscoped', incidentId, event.id),
    ...update,
    ...(showTimestamp ? { createdAt: serializeDate(event.createdAt) } : {}),
  };
}

function incidentDetailCutoffMs(settings: StatusPagePublicSettings, nowMs: number): number | null {
  // Show Incident History Details is the master toggle: when ON, historical details are never
  // redacted by age. When OFF, the numeric window controls how far back full detail is shown.
  if (settings.showIncidentHistoryDetails !== false) return null;
  const raw = settings.incidentHistoryDetailDays;
  if (raw == null) return null;
  const days = Math.max(1, Math.min(365, Math.floor(Number(raw))));
  if (!Number.isFinite(days)) return null;
  return nowMs - days * 86_400_000;
}

function shouldRedactByCutoff(
  incident: Pick<PublicIncidentInput, 'status' | 'createdAt'>,
  cutoffMs: number | null,
  settings: StatusPagePublicSettings
): boolean {
  if (cutoffMs == null) return false;
  // "Incident History Details" must never redact active incidents — those are current
  // communications, not historical. Only RESOLVED incidents older than the detail window are redacted.
  // When showIncidentHistoryDetails=false, the window above is still required; if no window is
  // configured we never redact here, which matches the fail-closed intent enforced via
  // statusPagePublicationLimits without silently hiding live incident detail.
  if (incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED') return false;
  if (settings.showIncidentHistoryDetails === false && incident.status !== 'RESOLVED') return false;
  if (!incident.createdAt) return false;
  const ms =
    incident.createdAt instanceof Date
      ? incident.createdAt.getTime()
      : Date.parse(String(incident.createdAt));
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
  const redactedByAge = shouldRedactByCutoff(incident, cutoffMs, settings);
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
    const updates = incident.events.slice(0, 8).flatMap(event => {
      const update = serializePublicIncidentUpdate(
        incident.id,
        event,
        context?.pageId,
        visibility.showIncidentTimestamp
      );
      return update ? [update] : [];
    });
    if (updates.length > 0) result.updates = updates;
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
