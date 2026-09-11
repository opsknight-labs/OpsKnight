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
      update = { type: 'ACKNOWLEDGED', message: 'Incident acknowledged' };
      break;
    case 'AUTO_RESOLVED':
    case 'MANUAL_RESOLVED':
      update = { type: 'RESOLVED', message: 'Incident resolved' };
      break;
    case 'REOPENED':
      update = { type: 'UPDATE', message: 'Incident reopened' };
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

/** Shape every public endpoint from the same status-page visibility controls. */
export function serializePublicStatusIncident(
  incident: PublicIncidentInput,
  settings: StatusPagePublicSettings,
  context?: { pageId: string }
): PublicIncident {
  const visibility = publicStatusVisibility(settings);
  const result: PublicIncident = { status: incident.status as PublicIncidentStatus };
  if (context?.pageId) {
    result.publicEventId = publicStatusIncidentEventId(context.pageId, incident.id);
  }

  if (visibility.showIncidentId) result.id = incident.id;
  if (visibility.showIncidentTitle) result.title = incident.title;
  if (visibility.showIncidentDescription && incident.description) {
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
  if (visibility.showIncidentId && visibility.showIncidentDescription && incident.events?.length) {
    const updates = incident.events.flatMap(event => {
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

  return result;
}

/**
 * Keep the long-standing `/api/status` incident shape while applying the
 * same visibility policy used by the other public status endpoints.
 */
export function serializePublicStatusApiIncident(
  incident: PublicIncidentInput,
  settings: StatusPagePublicSettings,
  context?: { pageId: string }
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
