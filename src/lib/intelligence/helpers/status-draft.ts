/**
 * A status-page update drafted from an open incident. Pure: the loader supplies the incident, the components
 * the page shows and the active dependency edges. The wording is public-safe by construction: it names only
 * components the page already shows and never copies the incident's internal title or description.
 */
import { downstreamDistances, type DependencyEdge } from '../dependencies/graph';

export interface StatusDraftIncident {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceId: string;
}

export interface StatusDraftComponent {
  serviceId: string;
  /** The name the page shows for this component. */
  name: string;
}

export interface StatusDraft {
  incidentId: string;
  /** Internal, for the editor's picker only; not part of the drafted text. */
  incidentTitle: string;
  type: 'INCIDENT' | 'WARNING';
  title: string;
  message: string;
  /** Page components to pre-select: the incident's own first, then those that depend on it, nearest first. */
  affected: Array<StatusDraftComponent & { reason: 'SOURCE' | 'DEPENDS_ON_SOURCE' }>;
}

/** Dependents further away than this are too speculative to pre-select on a public page. */
export const STATUS_DRAFT_MAX_DEPTH = 2;
/** Names spelled out in the text; the rest are counted. */
const MAX_NAMED = 3;

function nameList(names: readonly string[]): string {
  const named = names.slice(0, MAX_NAMED);
  const rest = names.length - named.length;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  if (named.length <= 1) return named[0] ?? '';
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/** Null when the incident touches nothing this page shows: there is nothing to tell its readers. */
export function draftStatusUpdate(
  incident: StatusDraftIncident,
  components: readonly StatusDraftComponent[],
  edges: readonly DependencyEdge[]
): StatusDraft | null {
  const { distances } = downstreamDistances(edges, incident.serviceId, STATUS_DRAFT_MAX_DEPTH);
  const affected = components
    .map(component => ({
      component,
      distance: component.serviceId === incident.serviceId ? 0 : distances.get(component.serviceId),
    }))
    .filter((row): row is typeof row & { distance: number } => row.distance !== undefined)
    .sort((a, b) => a.distance - b.distance || a.component.name.localeCompare(b.component.name))
    .map(({ component, distance }) => ({
      ...component,
      reason: distance === 0 ? ('SOURCE' as const) : ('DEPENDS_ON_SOURCE' as const),
    }));
  if (affected.length === 0) return null;

  const names = nameList(affected.map(component => component.name));
  const identified = incident.status === 'ACKNOWLEDGED';
  return {
    incidentId: incident.id,
    incidentTitle: incident.title,
    type: incident.urgency === 'HIGH' ? 'INCIDENT' : 'WARNING',
    title: `${identified ? 'Identified' : 'Investigating'}: issue affecting ${names}`,
    message: identified
      ? `We have identified an issue affecting ${names} and are working on a fix. We will post another update as soon as we have more to share.`
      : `We are investigating an issue affecting ${names}. We will post another update as soon as we know more.`,
    affected,
  };
}
