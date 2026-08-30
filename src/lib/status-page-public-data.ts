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
  service?: { name?: string; region?: string | null } | null;
};

function serializeDate(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Shape every public endpoint from the same status-page visibility controls. */
export function serializePublicStatusIncident(
  incident: PublicIncidentInput,
  settings: StatusPagePublicSettings
): Record<string, unknown> {
  const visibility = publicStatusVisibility(settings);
  const result: Record<string, unknown> = { status: incident.status };

  if (visibility.showIncidentId) result.id = incident.id;
  if (visibility.showIncidentTitle) result.title = incident.title;
  if (visibility.showIncidentDescription && incident.description) {
    result.description = incident.description;
  }
  if (visibility.showIncidentUrgency && incident.urgency) result.urgency = incident.urgency;
  if (visibility.showIncidentTimestamp) {
    result.createdAt = serializeDate(incident.createdAt);
    result.resolvedAt = serializeDate(incident.resolvedAt);
  }
  if (visibility.showAffectedService && incident.service) {
    result.service = {
      ...(incident.service.name ? { name: incident.service.name } : {}),
      ...(visibility.showServiceRegion ? { region: incident.service.region ?? null } : {}),
    };
  }

  return result;
}

/**
 * Keep the long-standing `/api/status` incident shape while applying the
 * same visibility policy used by the other public status endpoints.
 */
export function serializePublicStatusApiIncident(
  incident: PublicIncidentInput,
  settings: StatusPagePublicSettings
): Record<string, unknown> {
  const result = serializePublicStatusIncident(incident, settings);
  const service = result.service;
  if (!service || typeof service !== 'object' || Array.isArray(service)) return result;

  const { service: _service, ...withoutService } = result;
  const publicService = service as { name?: unknown; region?: unknown };
  return {
    ...withoutService,
    ...(typeof publicService.name === 'string' ? { service: publicService.name } : {}),
    ...('region' in publicService ? { serviceRegion: publicService.region } : {}),
  };
}
