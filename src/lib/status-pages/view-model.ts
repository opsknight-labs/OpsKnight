import type { StatusPageSnapshot } from './snapshot';

export type StatusPageSnapshotPage = {
  id: string;
  name: string;
  organizationName?: string | null;
  branding?: unknown;
  showSubscribe?: boolean;
  showServicesByRegion?: boolean;
  showRegionHeatmap?: boolean;
  showPostIncidentReview?: boolean;
  showChangelog?: boolean;
  enableUptimeExports?: boolean;
  footerText?: string | null;
  contactEmail?: string | null;
  contactUrl?: string | null;
  slug?: string | null;
  isDefault?: boolean;
};

function snapshotIncidentEvents(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const event = entry as { id?: unknown; message?: unknown; createdAt?: unknown };
    if (typeof event.message !== 'string') return [];
    return [
      {
        id: typeof event.id === 'string' ? event.id : `public-event-${index}`,
        message: event.message,
        createdAt: typeof event.createdAt === 'string' ? new Date(event.createdAt) : undefined,
      },
    ];
  });
}

export function createStatusPageViewModel(
  page: StatusPageSnapshotPage,
  snapshot: StatusPageSnapshot
) {
  const services = snapshot.services.map(service => ({
    ...service,
    region: service.regions?.join(', ') ?? null,
    _count: { incidents: service.activeIncidentCount ?? 0 },
  }));
  return {
    page,
    services,
    mappings: services.map((service, order) => ({
      id: `${page.id}:${service.id}`,
      serviceId: service.id,
      displayName: service.name,
      showOnPage: true,
      order,
    })),
    incidents: snapshot.incidents.map((incident, index) => {
      const service =
        incident.service && typeof incident.service === 'object' && !Array.isArray(incident.service)
          ? (incident.service as { name?: unknown; regions?: unknown })
          : {};
      const hasLinkablePostmortem = Boolean(
        incident.postmortem?.available === true && typeof incident.postmortem.id === 'string'
      );
      return {
        id:
          typeof incident.id === 'string'
            ? incident.id
            : typeof incident.publicEventId === 'string'
              ? incident.publicEventId
              : `public-${index}`,
        title: typeof incident.title === 'string' ? incident.title : 'Status update',
        description: typeof incident.description === 'string' ? incident.description : null,
        status: typeof incident.status === 'string' ? incident.status : 'OPEN',
        urgency: typeof incident.urgency === 'string' ? incident.urgency : 'MEDIUM',
        createdAt: typeof incident.createdAt === 'string' ? new Date(incident.createdAt) : undefined,
        acknowledgedAt:
          typeof incident.acknowledgedAt === 'string' ? new Date(incident.acknowledgedAt) : undefined,
        resolvedAt: typeof incident.resolvedAt === 'string' ? new Date(incident.resolvedAt) : null,
        service: {
          id: '',
          name: typeof service.name === 'string' ? service.name : 'Service',
          region: Array.isArray(service.regions) ? service.regions.join(', ') : null,
        },
        events: snapshotIncidentEvents(incident.updates),
        // The legacy renderer turns this marker into a clickable link using `id`. Only preserve
        // it when the V3 projection also provided a real public postmortem id; otherwise a
        // privacy-hidden incident id would become a fabricated /postmortems/public-N URL.
        postIncidentReview: incident.postIncidentReview === true && hasLinkablePostmortem,
      };
    }),
    announcements: snapshot.announcements.map(item => ({
      ...item,
      startDate: new Date(item.startDate),
      endDate: item.endDate ? new Date(item.endDate) : null,
    })),
    uptime: Object.fromEntries(
      snapshot.services.flatMap(service =>
        service.uptime?.days90.percentage == null
          ? []
          : [[service.id, service.uptime.days90.percentage]]
      )
    ),
    uptime30: Object.fromEntries(
      snapshot.services.flatMap(service =>
        service.uptime?.days30.percentage == null
          ? []
          : [[service.id, service.uptime.days30.percentage]]
      )
    ),
    statusHistory: Object.fromEntries(
      snapshot.services.map(service => [service.id, service.history ?? []])
    ),
  };
}
